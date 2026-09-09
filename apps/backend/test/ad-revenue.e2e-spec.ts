/**
 * Revenue split by Ad, end to end — which of the four creatives under one push
 * actually sold something.
 *
 * The seam runs the full length of the claim, as the Campaign report's does: a
 * sale arrives through the public storefront GraphQL API carrying `utm_content`
 * alongside its other tags, and the merchant reads the money back through the
 * admin REST API resolved onto the Ad that earned it. Everything between is the
 * real application against a local Postgres database, and every figure asserted
 * is worked out by hand from the seeded prices rather than recomputed by the
 * test.
 *
 * What is being proven is ADR-0004's two-pass resolution where it is hardest to
 * fake: an Ad claiming only sales its own Campaign already won, two Campaigns
 * each running a `video-a` staying apart, and an Ad created after the fact
 * claiming the Orders its links already produced — because resolution happens at
 * read time (ADR-0001) and `utm_content` has been stamped on both Touches of
 * every Order since.
 *
 * The unit tests next door in `ad-matching.util.spec.ts` exercise the matching
 * decision exhaustively. This file exists to prove the tag survives the whole
 * journey: storefront input, cart, checkout, order columns, report.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { productVariants } from '../src/shared/database/schema';
import { createTestApp } from './helpers/test-app';
import type { FakeStorageService } from './helpers/fake-storage.service';
import {
  createAdminUser,
  destroyAdminUsers,
  type AdminUserFixture,
} from './helpers/admin-fixture';
import {
  destroyStorefront,
  seedStorefront,
  type StorefrontFixture,
} from './helpers/storefront-fixture';

const CREATE_CART = /* GraphQL */ `
  mutation CreateCart($attribution: CartAttributionInput) {
    createCart(attribution: $attribution) {
      id
    }
  }
`;

const ADD_TO_CART = /* GraphQL */ `
  mutation AddToCart($cartId: ID!, $variantId: ID!, $quantity: Int!) {
    addToCart(cartId: $cartId, variantId: $variantId, quantity: $quantity) {
      id
    }
  }
`;

const CART_ATTRIBUTION = /* GraphQL */ `
  query CartAttribution($cartId: ID!) {
    cart(cartId: $cartId) {
      attribution {
        firstTouch {
          utmCampaign
          utmContent
        }
        lastTouch {
          utmCampaign
          utmContent
        }
      }
    }
  }
`;

const CHECKOUT = /* GraphQL */ `
  mutation Checkout($cartId: ID!, $input: CheckoutInput!) {
    checkout(cartId: $cartId, input: $input) {
      orderId
    }
  }
`;

const SHIPPING_ADDRESS = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  line1: '1 Analytical Way',
  city: 'Portland',
  state: 'OR',
  postalCode: '97201',
  countryCode: 'US',
};

const VARIANT_PRICE = 2500;
const SHIPPING_PRICE = 500;
/** What one seeded order is worth, in the smallest currency unit. */
const ORDER_TOTAL = VARIANT_PRICE + SHIPPING_PRICE;
/**
 * The goods basis of the same order — one unit, no shipping and no tax.
 * Deliberately a different number from `ORDER_TOTAL`, so a report reading the
 * wrong one of the two cannot pass.
 */
const ORDER_GOODS = VARIANT_PRICE;
/** What that unit costs the merchant, where a cost price has been entered. */
const UNIT_COST = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();
/** The same instant as a calendar day. The seeded store's timezone is UTC. */
const dayAgo = (days: number): string => daysAgo(days).slice(0, 10);

interface PerformanceFigures {
  orders: number;
  revenue: number;
  spend: number;
  /** A ratio, not money. Null when nothing was spent. */
  roas: number | null;
  goodsRevenue: number;
  cost: number;
  revenueWithCost: number;
  discount: number;
  /** Null when goods were sold and none of them have a cost price. */
  contributionMargin: number | null;
  costCoveragePct: number;
}

/**
 * The measured pair, in its own object because that is how it arrives — the one
 * part of a line that comes from the event stream rather than from Orders.
 */
interface MeasuredTraffic {
  visitors: number;
  conversionRatePct: number;
}

interface AdRevenueLine extends PerformanceFigures {
  adId: string;
  name: string;
  tag: string;
  status: string;
  creativeUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  measured: MeasuredTraffic | null;
}

interface CampaignRevenueLine extends PerformanceFigures {
  campaignId: string;
  name: string;
  tag: string;
  status: string;
  ads: AdRevenueLine[];
  unassigned: PerformanceFigures;
  measured: MeasuredTraffic | null;
}

interface AttributedRevenueReport {
  campaigns: CampaignRevenueLine[];
  unattributed: { orders: number; revenue: number };
  totals: { orders: number; revenue: number };
}

interface Touch {
  utmCampaign?: string;
  utmContent?: string;
  utmSource?: string;
  utmMedium?: string;
  occurredAt?: string;
}

describe('Revenue split by ad (e2e)', () => {
  let app: INestApplication<App>;
  let storage: FakeStorageService;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;

  beforeAll(async () => {
    ({ app, storage } = await createTestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    fixture = await seedStorefront(app, {
      variantPrice: VARIANT_PRICE,
      shippingPrice: SHIPPING_PRICE,
    });
    admin = await createAdminUser(app, fixture.organizationId, fixture.storeId);
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
    await destroyAdminUsers(app, [admin.id]);
  });

  // ─── Driving the real APIs ──────────────────────────────────────────────────

  /** Places one realized sale: cart → item → checkout → paid. */
  async function placeOrder(attribution?: {
    firstTouch?: Touch;
    lastTouch?: Touch;
  }): Promise<string> {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, attribution ? { attribution } : {});

    await fixture.storefront.query(ADD_TO_CART, {
      cartId: cart.id,
      variantId: fixture.variantId,
      quantity: 1,
    });

    const { checkout: result } = await fixture.storefront.query<{
      checkout: { orderId: string };
    }>(CHECKOUT, {
      cartId: cart.id,
      input: {
        shippingMethodId: fixture.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'ada@example.test',
      },
    });

    // `pending` is not revenue: the report counts the same four statuses the
    // sales reports do, so the order is advanced the way a merchant does it.
    await admin.client
      .patch(`/orders/${result.orderId}/status`, { status: 'paid' })
      .expect(200);

    return result.orderId;
  }

  async function createCampaign(
    name: string,
  ): Promise<{ id: string; tag: string }> {
    const res = await admin.client
      .post('/campaigns', { name, platform: 'meta' })
      .expect(201);
    return res.body as { id: string; tag: string };
  }

  async function createAd(
    campaignId: string,
    name: string,
  ): Promise<{ id: string; tag: string; name: string }> {
    const res = await admin.client
      .post(`/campaigns/${campaignId}/ads`, { name })
      .expect(201);
    return res.body as { id: string; tag: string; name: string };
  }

  /** Records one day's spend, against one creative or against the whole push. */
  async function recordSpend(
    campaignId: string,
    amount: number,
    adId?: string,
  ): Promise<void> {
    const path = adId
      ? `/campaigns/${campaignId}/ads/${adId}/spend`
      : `/campaigns/${campaignId}/spend`;
    await admin.client
      .post(path, { day: dayAgo(0), amount, currency: 'USD' })
      .expect(201);
  }

  async function setCostPrice(costPrice: number | null): Promise<void> {
    const db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
    await db
      .update(productVariants)
      .set({ costPrice })
      .where(eq(productVariants.id, fixture.variantId));
  }

  async function readReport(
    touch: 'first' | 'last' = 'last',
  ): Promise<AttributedRevenueReport> {
    const res = await admin.client
      .get(`/marketing/attributed-revenue?period=30d&touch=${touch}`)
      .expect(200);
    return res.body as AttributedRevenueReport;
  }

  const lineFor = (report: AttributedRevenueReport, campaignId: string) =>
    report.campaigns.find((c) => c.campaignId === campaignId)!;

  const adLineFor = (campaign: CampaignRevenueLine, adId: string) =>
    campaign.ads.find((ad) => ad.adId === adId);

  // ─── The storefront carries the tag ─────────────────────────────────────────

  it('passes utm_content through the storefront onto both touches', async () => {
    // Asserted rather than assumed: the whole split rests on this column
    // arriving, and nothing downstream would throw if it did not.
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, {
      attribution: {
        firstTouch: {
          utmCampaign: 'discovery',
          utmContent: 'video-a',
          occurredAt: daysAgo(7),
        },
        lastTouch: {
          utmCampaign: 'closer',
          utmContent: 'still-b',
          occurredAt: daysAgo(1),
        },
      },
    });

    const { cart: read } = await fixture.storefront.query<{
      cart: {
        attribution: {
          firstTouch: { utmCampaign: string; utmContent: string };
          lastTouch: { utmCampaign: string; utmContent: string };
        };
      };
    }>(CART_ATTRIBUTION, { cartId: cart.id });

    expect(read.attribution.firstTouch).toEqual({
      utmCampaign: 'discovery',
      utmContent: 'video-a',
    });
    expect(read.attribution.lastTouch).toEqual({
      utmCampaign: 'closer',
      utmContent: 'still-b',
    });
  });

  it('never fails a checkout over an attribution it cannot resolve', async () => {
    // Per ADR-0001, resolving attribution can never fail a sale. A tag naming
    // no ad — and one that is nothing but punctuation — still checks out.
    const summer = await createCampaign('Summer Sale');

    await expect(
      placeOrder({
        lastTouch: { utmCampaign: summer.tag, utmContent: '---' },
      }),
    ).resolves.toEqual(expect.any(String));

    const report = await readReport();
    expect(lineFor(report, summer.id).orders).toBe(1);
  });

  // ─── The split ──────────────────────────────────────────────────────────────

  it('splits a campaign’s revenue across the creatives that earned it', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');
    const still = await createAd(summer.id, 'Still B');

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: still.tag },
    });

    const campaign = lineFor(await readReport(), summer.id);

    expect(adLineFor(campaign, video.id)).toMatchObject({
      name: 'Beach video A',
      tag: video.tag,
      orders: 2,
      revenue: ORDER_TOTAL * 2,
      goodsRevenue: ORDER_GOODS * 2,
    });
    expect(adLineFor(campaign, still.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
      goodsRevenue: ORDER_GOODS,
    });
  });

  it('keeps an order matching the campaign and no ad in its own bucket', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });
    // A creative nobody created an ad for, and a link tagged with nothing.
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: 'carousel-c' },
    });
    await placeOrder({ lastTouch: { utmCampaign: summer.tag } });

    const campaign = lineFor(await readReport(), summer.id);

    expect(adLineFor(campaign, video.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    // Its own visible bucket, never spread across the ads that exist.
    expect(campaign.unassigned).toMatchObject({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });
  });

  it('never folds unassigned together with unattributed', async () => {
    const summer = await createCampaign('Summer Sale');
    await createAd(summer.id, 'Beach video A');

    // A campaign and no ad.
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: 'carousel-c' },
    });
    // No campaign at all — and carrying an ad tag, which must not rescue it.
    await placeOrder({ lastTouch: { utmContent: 'video-a' } });

    const report = await readReport();

    expect(lineFor(report, summer.id).unassigned).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(report.unattributed).toEqual({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
  });

  it('leaves the campaign’s own totals unchanged and reconciles the split to them', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');
    const still = await createAd(summer.id, 'Still B');
    await setCostPrice(UNIT_COST);

    await recordSpend(summer.id, 6000, video.id);
    await recordSpend(summer.id, 2000, still.id);
    // Recorded against the push as a whole: cost known, split not.
    await recordSpend(summer.id, 1000);

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: still.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: 'carousel-c' },
    });

    const campaign = lineFor(await readReport(), summer.id);

    // Three orders, worked out by hand: $30 each, $25 of goods each, $10 cost
    // each, $90 of spend across both grains.
    expect(campaign).toMatchObject({
      orders: 3,
      revenue: ORDER_TOTAL * 3,
      goodsRevenue: ORDER_GOODS * 3,
      cost: UNIT_COST * 3,
      spend: 9000,
    });

    const lines = [...campaign.ads, campaign.unassigned];
    const sum = (
      key: 'orders' | 'revenue' | 'goodsRevenue' | 'cost' | 'spend',
    ) => lines.reduce((total, line) => total + line[key], 0);

    expect(sum('orders')).toBe(campaign.orders);
    expect(sum('revenue')).toBe(campaign.revenue);
    expect(sum('goodsRevenue')).toBe(campaign.goodsRevenue);
    expect(sum('cost')).toBe(campaign.cost);
    expect(sum('spend')).toBe(campaign.spend);

    // The unsplit figure lands on the unassigned line, never divided among the
    // creatives it is not a total of.
    expect(campaign.unassigned.spend).toBe(1000);
  });

  // ─── Two campaigns, one tag ─────────────────────────────────────────────────

  it('resolves two campaigns each running a video-a independently', async () => {
    const summer = await createCampaign('Summer Sale');
    const spring = await createCampaign('Spring Sale');
    const summerVideo = await createAd(summer.id, 'Video A');
    const springVideo = await createAd(spring.id, 'Video A');

    // The same ad tag under both campaigns, which is the thing merchants
    // actually do — ad tags are unique within a campaign, not within a store.
    expect(summerVideo.tag).toBe(springVideo.tag);

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: summerVideo.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: spring.tag, utmContent: springVideo.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: spring.tag, utmContent: springVideo.tag },
    });

    const report = await readReport();
    const summerLine = lineFor(report, summer.id);
    const springLine = lineFor(report, spring.id);

    expect(adLineFor(summerLine, summerVideo.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(adLineFor(springLine, springVideo.id)).toMatchObject({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });

    // Neither campaign's split has heard of the other's creative, and neither
    // has an order it did not earn.
    expect(adLineFor(summerLine, springVideo.id)).toBeUndefined();
    expect(adLineFor(springLine, summerVideo.id)).toBeUndefined();
    expect(summerLine.unassigned.orders).toBe(0);
    expect(springLine.unassigned.orders).toBe(0);
  });

  it('reads Video_A and video-a as one ad', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Video A');

    // Real marketing links go out tagged inconsistently. Both sides of the
    // comparison are normalized, so these are one creative and not two.
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });
    await placeOrder({
      lastTouch: {
        utmCampaign: summer.tag,
        utmContent: video.tag.replace(/-/g, '_').toUpperCase(),
      },
    });

    const campaign = lineFor(await readReport(), summer.id);

    expect(adLineFor(campaign, video.id)).toMatchObject({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });
    expect(campaign.unassigned.orders).toBe(0);
  });

  // ─── Read-time resolution ───────────────────────────────────────────────────

  it('lets an ad created today claim the orders its links already produced', async () => {
    const summer = await createCampaign('Summer Sale');

    // The links ran before anyone thought to split the push. Nothing about
    // these orders changes afterwards — attribution is resolved on every read.
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: 'video-a' },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: 'video-a' },
    });

    const before = lineFor(await readReport(), summer.id);
    expect(before.ads).toEqual([]);
    expect(before.unassigned).toMatchObject({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });

    const video = await createAd(summer.id, 'Video A');

    const after = lineFor(await readReport(), summer.id);
    expect(adLineFor(after, video.id)).toMatchObject({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });
    expect(after.unassigned.orders).toBe(0);
    // And the campaign's own figures did not move.
    expect(after.orders).toBe(before.orders);
    expect(after.revenue).toBe(before.revenue);
  });

  // ─── Both touches ───────────────────────────────────────────────────────────

  it('splits by ad under first touch and last touch alike', async () => {
    const summer = await createCampaign('Summer Sale');
    const discovery = await createAd(summer.id, 'Discovery video');
    const closer = await createAd(summer.id, 'Retargeting still');

    // One visitor, discovered by one creative and closed by another. Both
    // touches carry utm_content, so this is a re-read rather than a migration.
    await placeOrder({
      firstTouch: {
        utmCampaign: summer.tag,
        utmContent: discovery.tag,
        occurredAt: daysAgo(7),
      },
      lastTouch: {
        utmCampaign: summer.tag,
        utmContent: closer.tag,
        occurredAt: daysAgo(1),
      },
    });

    const byFirst = lineFor(await readReport('first'), summer.id);
    expect(adLineFor(byFirst, discovery.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(adLineFor(byFirst, closer.id)).toMatchObject({ orders: 0 });

    const byLast = lineFor(await readReport('last'), summer.id);
    expect(adLineFor(byLast, closer.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(adLineFor(byLast, discovery.id)).toMatchObject({ orders: 0 });
  });

  // ─── Spend, ROAS and margin per ad ──────────────────────────────────────────

  it('divides each ad’s own spend into its own revenue', async () => {
    const summer = await createCampaign('Summer Sale');
    const winner = await createAd(summer.id, 'Winner');
    const loser = await createAd(summer.id, 'Loser');

    // $20 on the winner, which brought back two $30 sales: 3.00×. $50 on the
    // loser, which brought back nothing: 0.00×, and that is a real zero.
    await recordSpend(summer.id, 2000, winner.id);
    await recordSpend(summer.id, 5000, loser.id);

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: winner.tag },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: winner.tag },
    });

    const campaign = lineFor(await readReport(), summer.id);

    expect(adLineFor(campaign, winner.id)).toMatchObject({
      spend: 2000,
      revenue: 6000,
      roas: 3,
    });
    expect(adLineFor(campaign, loser.id)).toMatchObject({
      spend: 5000,
      revenue: 0,
      roas: 0,
    });
    // The campaign still divides its own total spend into its own revenue.
    expect(campaign).toMatchObject({ spend: 7000, revenue: 6000 });
  });

  it('withholds a per-ad ROAS where nothing was spent', async () => {
    const summer = await createCampaign('Summer Sale');
    const organic = await createAd(summer.id, 'Organic post');

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: organic.tag },
    });

    const campaign = lineFor(await readReport(), summer.id);
    const line = adLineFor(campaign, organic.id)!;

    // Null, never zero and never infinity: a creative nobody funded has no
    // return *on spend*, and the honest answer is that there is no figure.
    expect(line.revenue).toBe(ORDER_TOTAL);
    expect(line.roas).toBeNull();
  });

  it('withholds a per-ad margin where no goods were costed', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Video A');
    await recordSpend(summer.id, 1000, video.id);

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });

    // Nobody has entered a cost price. A margin here would report the whole
    // sale as profit, which is fiction — the blank is what sends a merchant to
    // fill their costs in.
    const uncosted = adLineFor(
      lineFor(await readReport(), summer.id),
      video.id,
    )!;
    expect(uncosted.contributionMargin).toBeNull();
    expect(uncosted.costCoveragePct).toBe(0);

    await setCostPrice(UNIT_COST);

    // Entered late, and the margin repairs on the next read rather than only
    // affecting the next sale. $25 of goods, no discount, $10 of cost, $10 of
    // spend: $5.
    const costed = adLineFor(lineFor(await readReport(), summer.id), video.id)!;
    expect(costed.contributionMargin).toBe(ORDER_GOODS - UNIT_COST - 1000);
    expect(costed.costCoveragePct).toBe(100);
  });

  it('keeps ad money in minor units and the ratio out of the formatter', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Video A');
    await recordSpend(summer.id, 1500, video.id);
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });

    const line = adLineFor(lineFor(await readReport(), summer.id), video.id)!;

    // Integers with no symbol and no decimal point — nothing a caller has to
    // parse back. ROAS is the one figure that is deliberately not an integer:
    // $30 over $15 is 2, a ratio, not 2 cents.
    expect(Number.isInteger(line.revenue)).toBe(true);
    expect(Number.isInteger(line.spend)).toBe(true);
    expect(Number.isInteger(line.goodsRevenue)).toBe(true);
    expect(line.roas).toBe(2);
  });

  // ─── Which ads appear ───────────────────────────────────────────────────────

  it('returns no split for a campaign nobody has divided', async () => {
    const summer = await createCampaign('Summer Sale');
    await placeOrder({ lastTouch: { utmCampaign: summer.tag } });

    const campaign = lineFor(await readReport(), summer.id);

    // A campaign without ads reports exactly as it did before ads existed.
    expect(campaign.ads).toEqual([]);
    expect(campaign.unassigned).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
  });

  it('keeps an archived creative on the report while it still explains money', async () => {
    const summer = await createCampaign('Summer Sale');
    const retired = await createAd(summer.id, 'Retired video');
    const quiet = await createAd(summer.id, 'Quiet still');

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: retired.tag },
    });

    await admin.client
      .post(`/campaigns/${summer.id}/ads/${retired.id}/archive`)
      .expect(201);
    await admin.client
      .post(`/campaigns/${summer.id}/ads/${quiet.id}/archive`)
      .expect(201);

    const campaign = lineFor(await readReport(), summer.id);

    // The one that earned money stays, still explaining it. The one that did
    // nothing leaves, rather than accumulating on the page forever.
    expect(adLineFor(campaign, retired.id)).toMatchObject({
      status: 'archived',
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(adLineFor(campaign, quiet.id)).toBeUndefined();
  });

  // ─── What a card is read by ─────────────────────────────────────────────────

  /** The smallest valid PNG, so the upload has real bytes to validate. */
  const PNG_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('carries the creative and the flight dates beside the figures', async () => {
    // A merchant recognises an ad by its picture, not by its slug, so the
    // report has to answer with the identity as well as the money. It is one
    // read rather than two: a card assembled from a second request for the ads
    // would be free to disagree with the figures about which creatives exist,
    // and nothing on screen could say which half to believe.
    const summer = await createCampaign('Summer Sale');
    const res = await admin.client
      .post(`/campaigns/${summer.id}/ads`, {
        name: 'Beach video',
        startsAt: '2026-09-01',
        endsAt: '2026-09-14',
      })
      .expect(201);
    const beach = res.body as { id: string; tag: string };
    const plain = await createAd(summer.id, 'Plain still');

    await admin.client
      .attach(
        `/campaigns/${summer.id}/ads/${beach.id}/creative`,
        'file',
        PNG_PIXEL,
        {
          filename: 'beach.png',
          contentType: 'image/png',
        },
      )
      .expect(201);

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: beach.tag },
    });

    const campaign = lineFor(await readReport(), summer.id);
    const beachLine = adLineFor(campaign, beach.id)!;

    // The URL of the object the upload actually stored — not a shape the test
    // reproduces, which would pass against a service that stored nothing.
    const stored = storage.stored.at(-1)!;
    expect(beachLine.creativeUrl).toBe(storage.getPublicUrl(stored.key));
    expect(beachLine.startsAt).toMatch(/^2026-09-01/);
    expect(beachLine.endsAt).toMatch(/^2026-09-14/);
    expect(beachLine.revenue).toBe(ORDER_TOTAL);

    // The majority state, and a designed one: an ad on a campaign that no sync
    // will ever supply an image for reports a null, never a placeholder URL the
    // admin would have to recognise as meaning "none".
    const plainLine = adLineFor(campaign, plain.id)!;
    expect(plainLine.creativeUrl).toBeNull();
    expect(plainLine.startsAt).toBeNull();
    expect(plainLine.endsAt).toBeNull();
  });

  // ─── Visitors and conversion rate ───────────────────────────────────────────
  // The report's only measured figures, and the only ones on it that do not
  // come from Orders. They arrive through the public ingest API the way a
  // tracker delivers them, and are read back off the same admin report as
  // everything else — which is the whole seam: a tag typed into a link has to
  // survive the beacon, the ingest, both matchers and the join.

  /** Records one visit, the way the drop-in tracker posts it. */
  async function trackVisit(
    visitorId: string,
    utmCampaign: string,
    utmContent?: string,
  ): Promise<void> {
    await fixture.storefront
      .track([
        {
          type: 'page_view',
          sessionId: `session-${visitorId}`,
          visitorId,
          path: '/',
          utmCampaign,
          ...(utmContent === undefined ? {} : { utmContent }),
        },
      ])
      .expect(202);
  }

  it('reports the visitors a campaign and each of its creatives were seen by', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');
    const still = await createAd(summer.id, 'Plain still B');

    // Four people on this push: two on the video, one on the still, one who
    // arrived on a link carrying no ad tag at all.
    await trackVisit('visitor-1', summer.tag, video.tag);
    await trackVisit('visitor-2', summer.tag, video.tag);
    await trackVisit('visitor-3', summer.tag, still.tag);
    await trackVisit('visitor-4', summer.tag);
    // The same person coming back. A visitor is a person, not a hit.
    await trackVisit('visitor-1', summer.tag, video.tag);

    // One of the four bought, through the video.
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });

    const campaign = lineFor(await readReport(), summer.id);

    // 1 purchase over the 4 people the stream saw.
    expect(campaign.measured).toEqual({ visitors: 4, conversionRatePct: 25 });

    // 1 purchase over the 2 it saw on this creative.
    expect(adLineFor(campaign, video.id)!.measured).toEqual({
      visitors: 2,
      conversionRatePct: 50,
    });

    // Seen by one person, bought by none — the distinction this whole feature
    // exists to draw. A creative nobody clicked reports nothing at all;
    // this one reports a real zero.
    expect(adLineFor(campaign, still.id)!.measured).toEqual({
      visitors: 1,
      conversionRatePct: 0,
    });
  });

  it('reports nothing, rather than zero, where the stream saw nobody', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');
    const unseen = await createAd(summer.id, 'Never clicked');

    await trackVisit('visitor-1', summer.tag, video.tag);
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });

    const report = await readReport();
    const campaign = lineFor(report, summer.id);

    // A zero here would say nobody came. What happened is that we did not see
    // anyone, which on an ad-blocked visit or a purged period is the same
    // creative and a very different claim.
    expect(adLineFor(campaign, unseen.id)!.measured).toBeNull();

    // And the residue carries no measured pair at all. Visitors do not
    // subdivide the way revenue does — one person can click two creatives — so
    // there is no subtraction for an unassigned figure to be the answer to.
    expect(campaign.unassigned).not.toHaveProperty('measured');
  });

  it('leaves a visitor no creative claims on the campaign and on no ad', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');

    // An untagged link and a tag naming no ad of this campaign. The campaign
    // saw both people; no creative is credited by default.
    await trackVisit('visitor-1', summer.tag);
    await trackVisit('visitor-2', summer.tag, 'video-z');

    const campaign = lineFor(await readReport(), summer.id);

    expect(campaign.measured).toEqual({ visitors: 2, conversionRatePct: 0 });
    expect(adLineFor(campaign, video.id)!.measured).toBeNull();
  });

  it('never credits a creative with a visitor of another campaign', async () => {
    // Two pushes each running a `video-a`, which is exactly what ad tags being
    // unique per campaign lets a merchant do. ADR-0004's property has to hold
    // for people as well as for money.
    const summer = await createCampaign('Summer Sale');
    const spring = await createCampaign('Spring Sale');
    const summerVideo = await createAd(summer.id, 'Video A');
    const springVideo = await createAd(spring.id, 'Video A');
    expect(summerVideo.tag).toBe(springVideo.tag);

    await trackVisit('visitor-1', summer.tag, summerVideo.tag);
    await trackVisit('visitor-2', spring.tag, springVideo.tag);
    await trackVisit('visitor-3', spring.tag, springVideo.tag);

    const report = await readReport();

    expect(
      adLineFor(lineFor(report, summer.id), summerVideo.id)!.measured,
    ).toEqual({ visitors: 1, conversionRatePct: 0 });
    expect(
      adLineFor(lineFor(report, spring.id), springVideo.id)!.measured,
    ).toEqual({ visitors: 2, conversionRatePct: 0 });
  });

  it('counts no bots among the visitors', async () => {
    // The same exclusion every other event query applies, and the same one the
    // attributed-revenue read applies to orders. A crawler is not an audience.
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');

    await trackVisit('visitor-1', summer.tag, video.tag);
    await fixture.storefront
      .track(
        [
          {
            type: 'page_view',
            sessionId: 'session-crawler',
            visitorId: 'visitor-crawler',
            utmCampaign: summer.tag,
            utmContent: video.tag,
          },
        ],
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      )
      .expect(202);

    const campaign = lineFor(await readReport(), summer.id);

    expect(campaign.measured).toEqual({ visitors: 1, conversionRatePct: 0 });
    expect(adLineFor(campaign, video.id)!.measured).toEqual({
      visitors: 1,
      conversionRatePct: 0,
    });
  });

  it('leaves every order-derived figure exactly as it was', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, utmContent: video.tag },
    });
    await recordSpend(summer.id, 1_000, video.id);

    // Read once with no traffic recorded at all, then again with a stream that
    // reports a hundred visitors. Nothing derived from money may move.
    const before = lineFor(await readReport(), summer.id);
    expect(before.measured).toBeNull();

    for (let i = 0; i < 100; i++) {
      await trackVisit(`visitor-${i}`, summer.tag, video.tag);
    }

    const after = lineFor(await readReport(), summer.id);

    expect(after.measured).toEqual({ visitors: 100, conversionRatePct: 1 });
    expect(after.revenue).toBe(before.revenue);
    expect(after.orders).toBe(before.orders);
    expect(after.spend).toBe(before.spend);
    expect(after.roas).toBe(before.roas);
    expect(after.contributionMargin).toBe(before.contributionMargin);
    expect(after.costCoveragePct).toBe(before.costCoveragePct);
    expect(after.goodsRevenue).toBe(before.goodsRevenue);
  });

  it('never counts one organization’s traffic toward another’s', async () => {
    const summer = await createCampaign('Summer Sale');
    const video = await createAd(summer.id, 'Beach video A');

    // A second merchant whose campaign and creative carry exactly the same
    // tags. The join is scoped to the organization and store like every other
    // read, so neither report may show the other's audience.
    const other = await seedStorefront(app, {
      variantPrice: VARIANT_PRICE,
      shippingPrice: SHIPPING_PRICE,
    });
    const otherAdmin = await createAdminUser(
      app,
      other.organizationId,
      other.storeId,
    );

    try {
      const otherSummer = (
        await otherAdmin.client
          .post('/campaigns', { name: 'Summer Sale', platform: 'meta' })
          .expect(201)
      ).body as { id: string; tag: string };
      const otherVideo = (
        await otherAdmin.client
          .post(`/campaigns/${otherSummer.id}/ads`, { name: 'Beach video A' })
          .expect(201)
      ).body as { id: string; tag: string };
      expect(otherSummer.tag).toBe(summer.tag);
      expect(otherVideo.tag).toBe(video.tag);

      await trackVisit('visitor-1', summer.tag, video.tag);
      await other.storefront
        .track([
          {
            type: 'page_view',
            sessionId: 'session-theirs-1',
            visitorId: 'visitor-theirs-1',
            utmCampaign: otherSummer.tag,
            utmContent: otherVideo.tag,
          },
          {
            type: 'page_view',
            sessionId: 'session-theirs-2',
            visitorId: 'visitor-theirs-2',
            utmCampaign: otherSummer.tag,
            utmContent: otherVideo.tag,
          },
        ])
        .expect(202);

      const mine = lineFor(await readReport(), summer.id);
      expect(mine.measured).toEqual({ visitors: 1, conversionRatePct: 0 });
      expect(adLineFor(mine, video.id)!.measured).toEqual({
        visitors: 1,
        conversionRatePct: 0,
      });

      const theirsReport = (
        await otherAdmin.client
          .get('/marketing/attributed-revenue?period=30d&touch=last')
          .expect(200)
      ).body as AttributedRevenueReport;
      const theirs = lineFor(theirsReport, otherSummer.id);
      expect(theirs.measured).toEqual({ visitors: 2, conversionRatePct: 0 });
    } finally {
      await destroyStorefront(app, other.organizationId);
      await destroyAdminUsers(app, [otherAdmin.id]);
    }
  });
});
