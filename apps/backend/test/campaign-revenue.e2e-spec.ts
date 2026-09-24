/**
 * Campaigns keyed by the ad platform, and the revenue credited to them, end to
 * end.
 *
 * Nothing syncs yet and nothing can be created yet, so Campaigns, Ads and the
 * platform's daily figures are seeded as rows — the shape the sync will write —
 * and everything else is real: a sale arrives through the public storefront
 * GraphQL API carrying the Link Tags a visitor clicked through with, and the
 * merchant reads the money back through the admin REST API. Every figure is
 * worked out by hand from the seeded prices rather than recomputed by the test.
 *
 * What is proven here is the join and the credit rule where they are hardest to
 * fake: an Order finds its Campaign and Ad by the platform's own ids, credit
 * goes to the latest ad click, an Order naming a Campaign and none of its Ads
 * stays on its own line, the Ads add up to their Campaign, and no Organization
 * ever reads another's Campaigns or figures. The rule itself is unit-tested in
 * `attributed-revenue.util.spec.ts`.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  adDailyFigures,
  ads,
  campaigns,
  orders,
  productVariants,
  stores,
  type AdFormat,
  type CampaignStatus,
} from '../src/shared/database/schema';
import type {
  AttributedRevenueReport,
  CampaignPerformanceReport,
} from '../src/modules/marketing/services/attributed-revenue.service';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
import { createTestApp } from './helpers/test-app';
import { AdminClient } from './helpers/admin-client';
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

const CHECKOUT = /* GraphQL */ `
  mutation Checkout($cartId: ID!, $input: CheckoutInput!) {
    checkout(cartId: $cartId, input: $input) {
      orderId
      total
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
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();
/** The fixture Store is in UTC, so its calendar day is the UTC one. */
const dayAgo = (days: number) => daysAgo(days).slice(0, 10);

/** A user agent the ingest classifier recognises as a crawler. */
const CRAWLER_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// Platform ids, as Meta writes them into a link at the moment of the click.
const SUMMER_EXT = '120200000000000001';
const SPRING_EXT = '120200000000000002';
const SUMMER_VIDEO_EXT = '120210000000000001';
const SUMMER_STILL_EXT = '120210000000000002';
const SPRING_VIDEO_EXT = '120210000000000003';

interface Touch {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  referrer?: string;
  landingPath?: string;
  occurredAt?: string;
}

/** A Touch as the Link Tags write it on a click through a Meta ad. */
const adClick = (
  campaignExt: string,
  adExt?: string,
  occurredAt = daysAgo(1),
): Touch => ({
  utmSource: 'meta',
  utmMedium: 'paid',
  utmCampaign: campaignExt,
  ...(adExt ? { utmContent: adExt } : {}),
  occurredAt,
});

interface SeededCampaign {
  id: string;
  externalId: string;
  /** Ad ids by platform ad id. */
  ads: Record<string, string>;
}

describe('Campaigns keyed by the platform (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let adPlatform: FakeAdPlatformProvider;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;

  beforeAll(async () => {
    ({ app, adPlatform } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // One organization and store reached two ways: the storefront places the
    // sales, the admin reads the report. That is the shape of the claim.
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

  // ─── Seeding what the sync will write ───────────────────────────────────────

  /**
   * One platform campaign and its ads, as rows — exactly what the sync will
   * insert once it exists.
   */
  async function seedCampaign(
    externalId: string,
    adExternalIds: string[] = [],
    opts: {
      at?: StorefrontFixture;
      name?: string;
      status?: CampaignStatus;
      hasLinkTags?: boolean;
      format?: AdFormat;
    } = {},
  ): Promise<SeededCampaign> {
    const at = opts.at ?? fixture;
    const [campaign] = await db
      .insert(campaigns)
      .values({
        organizationId: at.organizationId,
        storeId: at.storeId,
        platform: 'meta',
        externalId,
        name: opts.name ?? `Campaign ${externalId}`,
        status: opts.status ?? 'active',
        hasLinkTags: opts.hasLinkTags ?? true,
      })
      .returning();

    const seededAds: Record<string, string> = {};
    for (const adExt of adExternalIds) {
      const [ad] = await db
        .insert(ads)
        .values({
          organizationId: at.organizationId,
          storeId: at.storeId,
          campaignId: campaign.id,
          externalId: adExt,
          name: `Ad ${adExt}`,
          format: opts.format ?? 'image',
          status: opts.status ?? 'active',
          hasLinkTags: opts.hasLinkTags ?? true,
        })
        .returning();
      seededAds[adExt] = ad.id;
    }

    return { id: campaign.id, externalId, ads: seededAds };
  }

  async function seedFigures(
    adId: string,
    day: string,
    figures: { spend: number; impressions: number; clicks: number },
    at: StorefrontFixture = fixture,
  ): Promise<void> {
    await db.insert(adDailyFigures).values({
      organizationId: at.organizationId,
      storeId: at.storeId,
      adId,
      day,
      ...figures,
    });
  }

  // ─── Driving the real APIs ──────────────────────────────────────────────────

  /**
   * Places one realized sale: cart → item → checkout → paid.
   *
   * Advanced through the admin status endpoint rather than written directly,
   * because `pending` is not revenue and the report has to count the same
   * statuses the sales reports do.
   */
  async function placeOrder(
    attribution?: {
      firstTouch?: Touch;
      lastTouch?: Touch;
      visitorId?: string;
      sessionId?: string;
    },
    at: StorefrontFixture = fixture,
    as: AdminUserFixture = admin,
  ): Promise<string> {
    const { createCart: cart } = await at.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, attribution ? { attribution } : {});

    await at.storefront.query(ADD_TO_CART, {
      cartId: cart.id,
      variantId: at.variantId,
      quantity: 1,
    });

    const { checkout: result } = await at.storefront.query<{
      checkout: { orderId: string };
    }>(CHECKOUT, {
      cartId: cart.id,
      input: {
        shippingMethodId: at.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'ada@example.test',
      },
    });

    await as.client
      .patch(`/orders/${result.orderId}/status`, { status: 'paid' })
      .expect(200);

    return result.orderId;
  }

  async function readReport(
    as: AdminUserFixture = admin,
  ): Promise<AttributedRevenueReport> {
    const res = await as.client
      .get('/marketing/attributed-revenue?period=30d')
      .expect(200);
    return res.body as AttributedRevenueReport;
  }

  const lineFor = (report: AttributedRevenueReport, campaignId: string) =>
    report.campaigns.find((c) => c.campaignId === campaignId);

  const adLineFor = (
    report: AttributedRevenueReport,
    campaignId: string,
    adId: string,
  ) => lineFor(report, campaignId)?.ads.find((ad) => ad.adId === adId);

  async function trackEvent(
    sessionId: string,
    userAgent: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/events')
      .set('X-API-Key', fixture.apiKey)
      .set('User-Agent', userAgent)
      .send({ events: [{ type: 'page_view', sessionId, path: '/' }] })
      .expect(202);
  }

  // ─── The credit rule ────────────────────────────────────────────────────────

  describe('crediting the latest ad click', () => {
    it('credits the Campaign and the Ad the last touch names', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [
        SUMMER_VIDEO_EXT,
        SUMMER_STILL_EXT,
      ]);

      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });

      const report = await readReport();
      expect(lineFor(report, summer.id)).toMatchObject({
        orders: 1,
        revenue: ORDER_TOTAL,
        unassigned: { orders: 0, revenue: 0 },
      });
      expect(
        adLineFor(report, summer.id, summer.ads[SUMMER_VIDEO_EXT]),
      ).toMatchObject({ orders: 1, revenue: ORDER_TOTAL });
      expect(
        adLineFor(report, summer.id, summer.ads[SUMMER_STILL_EXT]),
      ).toMatchObject({ orders: 0, revenue: 0 });
      expect(report.unattributed).toEqual({ orders: 0, revenue: 0 });
    });

    it('credits the first touch’s Campaign when the last touch names none', async () => {
      const spring = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT]);

      // An ad click, then a search for the store's name. The search must not
      // cancel the ad's credit.
      await placeOrder({
        firstTouch: adClick(SPRING_EXT, SPRING_VIDEO_EXT, daysAgo(5)),
        lastTouch: {
          utmSource: 'google',
          utmMedium: 'organic',
          referrer: 'https://www.google.com/',
          occurredAt: daysAgo(1),
        },
      });

      const report = await readReport();
      expect(lineFor(report, spring.id)).toMatchObject({
        orders: 1,
        revenue: ORDER_TOTAL,
      });
      expect(
        adLineFor(report, spring.id, spring.ads[SPRING_VIDEO_EXT]),
      ).toMatchObject({ orders: 1, revenue: ORDER_TOTAL });
    });

    it('credits the last touch when both touches name different Campaigns', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const spring = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT]);

      await placeOrder({
        firstTouch: adClick(SPRING_EXT, SPRING_VIDEO_EXT, daysAgo(7)),
        lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT, daysAgo(1)),
      });

      const report = await readReport();
      expect(lineFor(report, summer.id)).toMatchObject({ orders: 1 });
      expect(lineFor(report, spring.id)).toMatchObject({ orders: 0 });
    });

    it('leaves an order naming no Campaign Unattributed, and still counts it', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);

      await placeOrder({
        lastTouch: {
          utmSource: 'newsletter',
          utmCampaign: 'july-digest',
          occurredAt: daysAgo(1),
        },
      });
      await placeOrder();

      const report = await readReport();
      expect(lineFor(report, summer.id)).toMatchObject({ orders: 0 });
      expect(report.unattributed).toEqual({
        orders: 2,
        revenue: ORDER_TOTAL * 2,
      });
      expect(report.totals).toEqual({ orders: 2, revenue: ORDER_TOTAL * 2 });
    });

    it('lets a campaign discovered after its orders claim them', async () => {
      // The ad ran and sold before the sync ever saw its campaign. The Order
      // kept the platform's ids; the Campaign row arriving later claims it.
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });
      expect((await readReport()).unattributed.orders).toBe(1);

      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const after = await readReport();

      expect(
        adLineFor(after, summer.id, summer.ads[SUMMER_VIDEO_EXT]),
      ).toMatchObject({ orders: 1, revenue: ORDER_TOTAL });
      expect(after.unattributed.orders).toBe(0);
    });

    it('denies credit to a touch older than the lookback window', async () => {
      const summer = await seedCampaign(SUMMER_EXT);

      await placeOrder({
        lastTouch: adClick(SUMMER_EXT, undefined, daysAgo(60)),
      });
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, undefined) });

      const report = await readReport();
      expect(report.lookbackDays).toBe(30);
      expect(lineFor(report, summer.id)).toMatchObject({ orders: 1 });
      expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    });

    it('never lets bot traffic appear to have driven a sale', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const botSession = 'session-crawler';

      await placeOrder({
        lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT),
        sessionId: botSession,
      });
      await trackEvent(botSession, CRAWLER_UA);

      const report = await readReport();
      expect(lineFor(report, summer.id)).toMatchObject({ orders: 0 });
      expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    });
  });

  // ─── The split by Ad ────────────────────────────────────────────────────────

  describe('the split by Ad', () => {
    it('keeps an order naming the Campaign but none of its Ads on its own line', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [
        SUMMER_VIDEO_EXT,
        SUMMER_STILL_EXT,
      ]);

      // A hand-edited link: the campaign id survived, the ad id did not.
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, 'not-an-ad') });

      const report = await readReport();
      const line = lineFor(report, summer.id)!;
      expect(line).toMatchObject({ orders: 1, revenue: ORDER_TOTAL });
      expect(line.unassigned).toEqual({ orders: 1, revenue: ORDER_TOTAL });
      // Never spread across the Ads that happen to exist.
      expect(line.ads.every((ad) => ad.orders === 0 && ad.revenue === 0)).toBe(
        true,
      );
      // And never folded into Unattributed: it has a Campaign.
      expect(report.unattributed).toEqual({ orders: 0, revenue: 0 });
    });

    it('never credits an Ad of a sibling Campaign', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const spring = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT]);

      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SPRING_VIDEO_EXT) });

      const report = await readReport();
      expect(lineFor(report, summer.id)!.unassigned.orders).toBe(1);
      expect(
        adLineFor(report, spring.id, spring.ads[SPRING_VIDEO_EXT]),
      ).toMatchObject({ orders: 0 });
    });

    it('adds the Ads and the unassigned line up to the Campaign exactly', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [
        SUMMER_VIDEO_EXT,
        SUMMER_STILL_EXT,
      ]);

      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_STILL_EXT) });
      await placeOrder({ lastTouch: adClick(SUMMER_EXT) });
      await placeOrder({
        firstTouch: adClick(SUMMER_EXT, SUMMER_STILL_EXT, daysAgo(3)),
        lastTouch: { utmSource: 'direct-mail', occurredAt: daysAgo(1) },
      });

      const line = lineFor(await readReport(), summer.id)!;
      expect(line).toMatchObject({ orders: 5, revenue: ORDER_TOTAL * 5 });

      const summed = line.ads.reduce(
        (sum, ad) => ({
          orders: sum.orders + ad.orders,
          revenue: sum.revenue + ad.revenue,
        }),
        line.unassigned,
      );
      expect(summed).toEqual({ orders: line.orders, revenue: line.revenue });
    });
  });

  // ─── The platform's figures ─────────────────────────────────────────────────

  describe('the platform’s daily figures', () => {
    it('sums each Ad’s days in the period, and the Campaign as its Ads’ sum', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [
        SUMMER_VIDEO_EXT,
        SUMMER_STILL_EXT,
      ]);
      const video = summer.ads[SUMMER_VIDEO_EXT];
      const still = summer.ads[SUMMER_STILL_EXT];

      await seedFigures(video, dayAgo(2), {
        spend: 12_34,
        impressions: 1000,
        clicks: 40,
      });
      await seedFigures(video, dayAgo(1), {
        spend: 5_00,
        impressions: 300,
        clicks: 10,
      });
      await seedFigures(still, dayAgo(1), {
        spend: 7_66,
        impressions: 700,
        clicks: 25,
      });
      // Outside the 30-day period: not part of this read.
      await seedFigures(still, dayAgo(45), {
        spend: 99_99,
        impressions: 9999,
        clicks: 999,
      });

      const report = await readReport();
      expect(adLineFor(report, summer.id, video)).toMatchObject({
        spend: 17_34,
        impressions: 1300,
        clicks: 50,
      });
      expect(adLineFor(report, summer.id, still)).toMatchObject({
        spend: 7_66,
        impressions: 700,
        clicks: 25,
      });
      expect(lineFor(report, summer.id)).toMatchObject({
        spend: 25_00,
        impressions: 2000,
        clicks: 75,
      });
    });

    it('reports zero figures for an Ad with no rows yet, as integers', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);

      const line = lineFor(await readReport(), summer.id)!;
      expect(line).toMatchObject({ spend: 0, impressions: 0, clicks: 0 });
      expect(line.ads[0]).toMatchObject({
        spend: 0,
        impressions: 0,
        clicks: 0,
      });
    });

    it('keeps one Ad’s day unique', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const video = summer.ads[SUMMER_VIDEO_EXT];
      const figures = { spend: 100, impressions: 10, clicks: 1 };

      await seedFigures(video, dayAgo(1), figures);
      await expect(seedFigures(video, dayAgo(1), figures)).rejects.toThrow();
    });
  });

  // ─── What a Campaign is ─────────────────────────────────────────────────────

  describe('the Campaign as the platform describes it', () => {
    it('carries the platform id, platform, status, schedule and cover, and its Ads theirs', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT], {
        name: 'Summer Sale 2026',
        status: 'paused',
        format: 'video',
      });

      const campaign = await admin.client
        .get(`/campaigns/${summer.id}`)
        .expect(200);
      expect(campaign.body).toMatchObject({
        id: summer.id,
        externalId: SUMMER_EXT,
        platform: 'meta',
        name: 'Summer Sale 2026',
        status: 'paused',
        startsAt: null,
        endsAt: null,
        coverUrl: null,
        hasLinkTags: true,
      });

      const adList = await admin.client
        .get(`/campaigns/${summer.id}/ads`)
        .expect(200);
      expect(adList.body).toEqual([
        expect.objectContaining({
          id: summer.ads[SUMMER_VIDEO_EXT],
          externalId: SUMMER_VIDEO_EXT,
          campaignId: summer.id,
          format: 'video',
          status: 'paused',
          creativeUrl: null,
          hasLinkTags: true,
        }),
      ]);
    });

    it('shows a Campaign with no Cover of its own by its biggest spender’s creative', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [
        SUMMER_VIDEO_EXT,
        SUMMER_STILL_EXT,
      ]);
      await db
        .update(ads)
        .set({ creativeUrl: 'https://cdn.test/video.jpg' })
        .where(eq(ads.id, summer.ads[SUMMER_VIDEO_EXT]));
      await db
        .update(ads)
        .set({ creativeUrl: 'https://cdn.test/still.jpg' })
        .where(eq(ads.id, summer.ads[SUMMER_STILL_EXT]));
      // The still outspent the video over its life, though not in the period.
      await seedFigures(summer.ads[SUMMER_VIDEO_EXT], dayAgo(2), {
        spend: 30_00,
        impressions: 100,
        clicks: 1,
      });
      await seedFigures(summer.ads[SUMMER_STILL_EXT], dayAgo(60), {
        spend: 80_00,
        impressions: 100,
        clicks: 1,
      });

      expect(lineFor(await readReport(), summer.id)!.coverUrl).toBe(
        'https://cdn.test/still.jpg',
      );

      // A Cover of its own always wins.
      await db
        .update(campaigns)
        .set({ coverUrl: 'https://cdn.test/own.jpg' })
        .where(eq(campaigns.id, summer.id));
      expect(lineFor(await readReport(), summer.id)!.coverUrl).toBe(
        'https://cdn.test/own.jpg',
      );
    });

    it('says when an Ended Campaign stopped, and nothing for a running one', async () => {
      const running = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const scheduled = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT], {
        status: 'ended',
      });
      const endsAt = new Date(daysAgo(45));
      await db
        .update(campaigns)
        .set({ endsAt })
        .where(eq(campaigns.id, scheduled.id));
      // Deleted on the platform with no end of its own: it stopped on the last
      // day it reported anything.
      const deleted = await seedCampaign(
        '120200000000000003',
        ['120210000000000009'],
        { status: 'ended' },
      );
      await seedFigures(deleted.ads['120210000000000009'], dayAgo(40), {
        spend: 5_00,
        impressions: 10,
        clicks: 0,
      });
      await seedFigures(deleted.ads['120210000000000009'], dayAgo(12), {
        spend: 5_00,
        impressions: 10,
        clicks: 0,
      });

      const report = await readReport();
      expect(lineFor(report, running.id)!.endedAt).toBeNull();
      expect(lineFor(report, scheduled.id)!.endedAt).toBe(endsAt.toISOString());
      expect(lineFor(report, deleted.id)!.endedAt).toBe(
        `${dayAgo(12)}T00:00:00.000Z`,
      );
    });

    it('defaults the link-tags flag to absent', async () => {
      const [row] = await db
        .insert(campaigns)
        .values({
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          platform: 'meta',
          externalId: SPRING_EXT,
          name: 'Discovered in Ads Manager',
          status: 'active',
        })
        .returning();
      const [ad] = await db
        .insert(ads)
        .values({
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          campaignId: row.id,
          externalId: SPRING_VIDEO_EXT,
          name: 'Discovered ad',
          status: 'active',
        })
        .returning();

      expect(row.hasLinkTags).toBe(false);
      expect(ad.hasLinkTags).toBe(false);

      const line = lineFor(await readReport(), row.id)!;
      expect(line.hasLinkTags).toBe(false);
    });

    it('keeps the platform campaign id unique within a store, but not across stores', async () => {
      await seedCampaign(SUMMER_EXT);
      await expect(seedCampaign(SUMMER_EXT)).rejects.toThrow();

      const other = await seedStorefront(app);
      try {
        await expect(
          seedCampaign(SUMMER_EXT, [], { at: other }),
        ).resolves.toBeDefined();
      } finally {
        await destroyStorefront(app, other.organizationId);
      }
    });

    it('keeps the platform ad id unique within a store', async () => {
      await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      await expect(
        seedCampaign(SPRING_EXT, [SUMMER_VIDEO_EXT]),
      ).rejects.toThrow();
    });

    it('offers no way to create, archive or delete a campaign or an ad here', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const adId = summer.ads[SUMMER_VIDEO_EXT];

      await admin.client
        .post('/campaigns', { name: 'x', platform: 'meta' })
        .expect(404);
      await admin.client.post(`/campaigns/${summer.id}/archive`).expect(404);
      await admin.client.delete(`/campaigns/${summer.id}`).expect(404);
      await admin.client.get(`/campaigns/${summer.id}/rules`).expect(404);
      await admin.client
        .post(`/campaigns/${summer.id}/ads/${adId}/archive`)
        .expect(404);
    });
  });

  // ─── Reconciliation ─────────────────────────────────────────────────────────

  it('never fails a checkout over Link Tags it cannot resolve', async () => {
    await expect(
      placeOrder({ lastTouch: adClick('---', '{{ad.id}}') }),
    ).resolves.toEqual(expect.any(String));
    expect((await readReport()).unattributed.orders).toBe(1);
  });

  it('reconciles with the sales reporting for the same period', async () => {
    const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);

    await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });
    await placeOrder();

    const report = await readReport();
    const stats = await admin.client
      .get('/dashboard/stats?period=30d')
      .expect(200);
    const { revenue } = stats.body as { revenue: { current: number } };

    expect(report.totals).toEqual({ orders: 2, revenue: ORDER_TOTAL * 2 });
    expect(report.totals.revenue).toBe(revenue.current);
    expect(
      lineFor(report, summer.id)!.revenue + report.unattributed.revenue,
    ).toBe(report.totals.revenue);
    expect(report.blended).toEqual({ orders: 1, revenue: ORDER_TOTAL });
  });

  // ─── One Campaign's page ────────────────────────────────────────────────────

  describe('one campaign’s page', () => {
    async function readPerformance(
      campaignId: string,
      period: '7d' | '30d' | '90d' | 'lifetime' = '30d',
      as: AdminUserFixture = admin,
    ): Promise<CampaignPerformanceReport> {
      const res = await as.client
        .get(`/marketing/campaigns/${campaignId}/performance?period=${period}`)
        .expect(200);
      return res.body as CampaignPerformanceReport;
    }

    async function setCostPrice(costPrice: number | null): Promise<void> {
      await db
        .update(productVariants)
        .set({ costPrice })
        .where(eq(productVariants.id, fixture.variantId));
    }

    it('is the same line the store report carries, with ads and residue adding up for every figure', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [
        SUMMER_VIDEO_EXT,
        SUMMER_STILL_EXT,
      ]);
      const video = summer.ads[SUMMER_VIDEO_EXT];
      const still = summer.ads[SUMMER_STILL_EXT];
      await seedFigures(video, dayAgo(2), {
        spend: 30_00,
        impressions: 3000,
        clicks: 60,
      });
      await seedFigures(still, dayAgo(1), {
        spend: 10_00,
        impressions: 1000,
        clicks: 20,
      });

      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_STILL_EXT) });
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, 'hand-edited') });

      const { campaign, lookbackDays, rangeStart } = await readPerformance(
        summer.id,
      );
      const storeLine = lineFor(await readReport(), summer.id)!;

      expect(lookbackDays).toBe(30);
      expect(rangeStart).not.toBeNull();
      for (const key of [
        'orders',
        'revenue',
        'spend',
        'impressions',
        'clicks',
      ] as const) {
        expect(campaign[key]).toBe(storeLine[key]);
      }
      expect(campaign).toMatchObject({
        orders: 3,
        revenue: ORDER_TOTAL * 3,
        spend: 40_00,
        impressions: 4000,
        clicks: 80,
        unassigned: { orders: 1, revenue: ORDER_TOTAL },
      });

      const summed = campaign.ads.reduce(
        (sum, ad) => ({
          orders: sum.orders + ad.orders,
          revenue: sum.revenue + ad.revenue,
          spend: sum.spend + ad.spend,
          impressions: sum.impressions + ad.impressions,
          clicks: sum.clicks + ad.clicks,
        }),
        { ...campaign.unassigned, spend: 0, impressions: 0, clicks: 0 },
      );
      expect(summed).toEqual({
        orders: campaign.orders,
        revenue: campaign.revenue,
        spend: campaign.spend,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
      });

      expect(campaign.roas).toBe((ORDER_TOTAL * 3) / 40_00);
      expect(campaign.conversionRate).toBe(3 / 80);
      expect(campaign.ads.find((a) => a.adId === video)!.roas).toBe(
        ORDER_TOTAL / 30_00,
      );
    });

    it('credits with the whole store’s index, not just this campaign’s', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const spring = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT]);

      // Names Spring first and Summer last: Summer's, and never Spring's.
      await placeOrder({
        firstTouch: adClick(SPRING_EXT, SPRING_VIDEO_EXT, daysAgo(4)),
        lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT, daysAgo(1)),
      });

      expect((await readPerformance(summer.id)).campaign.orders).toBe(1);
      expect((await readPerformance(spring.id)).campaign.orders).toBe(0);
    });

    it('withholds margin and ROI while any item sold lacks a cost price, and names the product', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      await seedFigures(summer.ads[SUMMER_VIDEO_EXT], dayAgo(1), {
        spend: 10_00,
        impressions: 100,
        clicks: 10,
      });
      await setCostPrice(null);
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });

      const { campaign } = await readPerformance(summer.id);
      expect(campaign.contributionMargin).toBeNull();
      expect(campaign.roi).toBeNull();
      expect(campaign.uncostedProducts).toEqual([
        { productId: fixture.productId, name: fixture.productName },
      ]);
      // Only the cost-based figures are withheld.
      expect(campaign.roas).toBe(ORDER_TOTAL / 10_00);
    });

    it('computes margin and ROI once every item sold has a cost price', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      await seedFigures(summer.ads[SUMMER_VIDEO_EXT], dayAgo(1), {
        spend: 10_00,
        impressions: 100,
        clicks: 10,
      });
      await setCostPrice(10_00);
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });

      const { campaign } = await readPerformance(summer.id);
      // 30.00 revenue − 10.00 goods − 10.00 spend.
      expect(campaign.contributionMargin).toBe(ORDER_TOTAL - 10_00 - 10_00);
      expect(campaign.roi).toBe((ORDER_TOTAL - 10_00 - 10_00) / 10_00);
      expect(campaign.uncostedProducts).toEqual([]);
    });

    it('reports ROAS and ROI as absent, not zero or infinite, at zero spend', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      await setCostPrice(10_00);
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });

      const { campaign } = await readPerformance(summer.id);
      expect(campaign.spend).toBe(0);
      expect(campaign.roas).toBeNull();
      expect(campaign.roi).toBeNull();
      expect(campaign.conversionRate).toBeNull();
      expect(campaign.ads[0].roas).toBeNull();
    });

    it('shows a Not Tracked campaign’s spend and nothing built on its revenue', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT], {
        hasLinkTags: false,
      });
      await seedFigures(summer.ads[SUMMER_VIDEO_EXT], dayAgo(1), {
        spend: 25_00,
        impressions: 900,
        clicks: 30,
      });

      const { campaign } = await readPerformance(summer.id);
      expect(campaign).toMatchObject({
        hasLinkTags: false,
        spend: 25_00,
        impressions: 900,
        clicks: 30,
        roas: null,
        conversionRate: null,
        contributionMargin: null,
        roi: null,
        uncostedProducts: [],
      });
      expect(campaign.ads[0].roas).toBeNull();
    });

    it('reads a campaign’s whole life under Lifetime', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      const video = summer.ads[SUMMER_VIDEO_EXT];
      await seedFigures(video, dayAgo(120), {
        spend: 40_00,
        impressions: 400,
        clicks: 4,
      });
      await seedFigures(video, dayAgo(1), {
        spend: 10_00,
        impressions: 100,
        clicks: 1,
      });
      const old = await placeOrder({
        lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT, daysAgo(121)),
      });
      await db
        .update(orders)
        .set({ createdAt: new Date(daysAgo(120)) })
        .where(eq(orders.id, old));
      await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });

      const quarter = await readPerformance(summer.id, '90d');
      expect(quarter.campaign).toMatchObject({ orders: 1, spend: 10_00 });

      const lifetime = await readPerformance(summer.id, 'lifetime');
      expect(lifetime.rangeStart).toBeNull();
      expect(lifetime.campaign).toMatchObject({
        orders: 2,
        revenue: ORDER_TOTAL * 2,
        spend: 50_00,
        impressions: 500,
        clicks: 5,
      });
    });

    it('carries each ad’s review verdict beside its status', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT], {
        status: 'paused',
      });
      await db
        .update(ads)
        .set({ reviewStatus: 'rejected' })
        .where(eq(ads.id, summer.ads[SUMMER_VIDEO_EXT]));

      const { campaign } = await readPerformance(summer.id);
      expect(campaign.ads[0]).toMatchObject({
        status: 'paused',
        reviewStatus: 'rejected',
      });
    });

    it('renders from stored figures while the ad platform is down', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      await seedFigures(summer.ads[SUMMER_VIDEO_EXT], dayAgo(1), {
        spend: 10_00,
        impressions: 100,
        clicks: 10,
      });
      const fetchesBefore = adPlatform.fetched.length;
      adPlatform.failAlways = new Error('vendor outage');
      try {
        const { campaign } = await readPerformance(summer.id);
        expect(campaign.spend).toBe(10_00);
        expect(adPlatform.fetched.length).toBe(fetchesBefore);
      } finally {
        adPlatform.failAlways = null;
      }
    });

    it('refuses an unknown period', async () => {
      const summer = await seedCampaign(SUMMER_EXT);
      await admin.client
        .get(`/marketing/campaigns/${summer.id}/performance?period=today`)
        .expect(400);
    });

    it('makes another organization’s campaign unreadable', async () => {
      const other = await seedStorefront(app);
      try {
        const theirs = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT], {
          at: other,
        });
        await admin.client
          .get(`/marketing/campaigns/${theirs.id}/performance?period=30d`)
          .expect(404);
      } finally {
        await destroyStorefront(app, other.organizationId);
      }
    });
  });

  // ─── Tenancy ────────────────────────────────────────────────────────────────

  describe('tenancy', () => {
    it('never credits one organization’s orders to another’s campaign with the same platform id', async () => {
      const mine = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);

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
        const theirs = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT], {
          at: other,
        });

        await placeOrder({ lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) });
        await placeOrder(
          { lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) },
          other,
          otherAdmin,
        );
        await placeOrder(
          { lastTouch: adClick(SUMMER_EXT, SUMMER_VIDEO_EXT) },
          other,
          otherAdmin,
        );

        const myReport = await readReport();
        expect(lineFor(myReport, mine.id)).toMatchObject({ orders: 1 });
        expect(lineFor(myReport, theirs.id)).toBeUndefined();
        expect(myReport.totals.orders).toBe(1);

        const theirReport = await readReport(otherAdmin);
        expect(lineFor(theirReport, theirs.id)).toMatchObject({ orders: 2 });
        expect(lineFor(theirReport, mine.id)).toBeUndefined();
      } finally {
        await destroyStorefront(app, other.organizationId);
        await destroyAdminUsers(app, [otherAdmin.id]);
      }
    });

    it('makes another organization’s campaign, ads and figures unreadable', async () => {
      const other = await seedStorefront(app);
      try {
        const theirs = await seedCampaign(SPRING_EXT, [SPRING_VIDEO_EXT], {
          at: other,
        });
        const theirAd = theirs.ads[SPRING_VIDEO_EXT];
        await seedFigures(
          theirAd,
          dayAgo(1),
          { spend: 50_00, impressions: 500, clicks: 5 },
          other,
        );

        await admin.client.get(`/campaigns/${theirs.id}`).expect(404);
        await admin.client.get(`/campaigns/${theirs.id}/ads`).expect(404);
        await admin.client
          .get(`/campaigns/${theirs.id}/ads/${theirAd}`)
          .expect(404);

        const list = await admin.client.get('/campaigns').expect(200);
        expect(list.body).toEqual([]);

        const report = await readReport();
        expect(report.campaigns).toEqual([]);
      } finally {
        await destroyStorefront(app, other.organizationId);
      }
    });

    it('scopes a campaign and its figures to the store, not just the organization', async () => {
      const summer = await seedCampaign(SUMMER_EXT, [SUMMER_VIDEO_EXT]);
      await seedFigures(summer.ads[SUMMER_VIDEO_EXT], dayAgo(1), {
        spend: 10_00,
        impressions: 100,
        clicks: 3,
      });

      // A second store in the same organization, reached by the same admin.
      const [secondStore] = await db
        .insert(stores)
        .values({
          organizationId: fixture.organizationId,
          name: 'Second store',
          slug: `second-${Date.now()}`,
        })
        .returning();
      const secondClient = new AdminClient(
        app,
        admin.accessToken,
        secondStore.id,
      );

      await secondClient.get(`/campaigns/${summer.id}`).expect(404);
      const res = await secondClient
        .get('/marketing/attributed-revenue?period=30d')
        .expect(200);
      expect((res.body as AttributedRevenueReport).campaigns).toEqual([]);
    });
  });

  // ─── Permissions ────────────────────────────────────────────────────────────

  describe('permissions', () => {
    it('lets a product manager read campaigns and the report', async () => {
      const summer = await seedCampaign(SUMMER_EXT);
      const pm = await createAdminUser(
        app,
        fixture.organizationId,
        fixture.storeId,
        'product_manager',
      );
      try {
        await pm.client.get(`/campaigns/${summer.id}`).expect(200);
        await readReport(pm);
      } finally {
        await destroyAdminUsers(app, [pm.id]);
      }
    });

    it('refuses a support agent, who has no marketing permission', async () => {
      const agent = await createAdminUser(
        app,
        fixture.organizationId,
        fixture.storeId,
        'support_agent',
      );
      try {
        await agent.client.get('/campaigns').expect(403);
        await agent.client
          .get('/marketing/attributed-revenue?period=30d')
          .expect(403);
      } finally {
        await destroyAdminUsers(app, [agent.id]);
      }
    });

    it('rejects a request carrying no admin token', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/campaigns')
        .set('X-Store-Id', fixture.storeId)
        .expect(401);
    });
  });
});
