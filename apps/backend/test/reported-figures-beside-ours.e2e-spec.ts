/**
 * The platform's figures beside ours, end to end.
 *
 * The seam runs the full length of both books at once. A real sale arrives
 * through the public storefront GraphQL API carrying `utm_content`, and becomes
 * our revenue, our spend and our Contribution Margin. The fake ad platform
 * reports the same creative spending and earning something quite different, and
 * that becomes the platform's book. The merchant then reads **one** admin
 * response and has to be able to tell the two apart.
 *
 * What is proven here is ADR-0005 where it is hardest to fake:
 *
 *  - both sets of figures come back from one read, each labelled with its
 *    source and the window it was measured over;
 *  - the platform's figures do not move ours by a cent, present or absent;
 *  - a reported revenue of any size leaves Contribution Margin exactly where it
 *    was, because a platform's conversion value has no cost basis behind it;
 *  - an ad account in another currency yields no combined ratio at all — the
 *    merchant is shown the mismatch rather than a number built on a rate nobody
 *    chose.
 *
 * Every figure asserted is worked out by hand from the seeded prices and the
 * figures the fake was told to report, never recomputed by the test.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { productVariants } from '../src/shared/database/schema';
import type { AdPlatform } from '../src/shared/database/schema';
import type { AdTree } from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import { createTestApp } from './helpers/test-app';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
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

const VARIANT_PRICE = 100_00;
const SHIPPING_PRICE = 5_00;
/** What one seeded order is worth on the order-total basis, which ROAS divides. */
const ORDER_TOTAL = VARIANT_PRICE + SHIPPING_PRICE;
/** The goods basis of the same order, which Contribution Margin is built on. */
const ORDER_GOODS = VARIANT_PRICE;
/** What that unit costs the merchant. */
const UNIT_COST = 40_00;

/** What we recorded ourselves. Deliberately not what the platform reports. */
const OUR_SPEND = 50_00;

/**
 * What the platform claims, and every one of these is a different number from
 * ours on purpose: a test whose two books agreed would pass with them merged.
 */
const THEIR_SPEND = 47_50;
const THEIR_REVENUE = 400_00;

const today = (): string => new Date().toISOString().slice(0, 10);

interface ReportedAdFigures {
  platform: AdPlatform;
  currency: string;
  storeCurrency: string;
  matchesStoreCurrency: boolean;
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number | null;
  attribution: { clickDays: number; viewDays: number | null } | null;
  days: number;
  firstDay: string;
  lastDay: string;
  syncedAt: string;
}

interface AdRevenueLine {
  adId: string;
  name: string;
  tag: string;
  orders: number;
  revenue: number;
  spend: number;
  roas: number | null;
  goodsRevenue: number;
  cost: number;
  revenueWithCost: number;
  discount: number;
  contributionMargin: number | null;
  costCoveragePct: number;
  reported: ReportedAdFigures[];
}

interface CampaignRevenueLine {
  campaignId: string;
  ads: AdRevenueLine[];
}

interface AttributedRevenueReport {
  lookbackDays: number;
  campaigns: CampaignRevenueLine[];
}

describe('Reported figures beside ours (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;

  beforeAll(async () => {
    ({ app, adPlatform: provider } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    provider.reset();
    fixture = await seedStorefront(app, {
      variantPrice: VARIANT_PRICE,
      shippingPrice: SHIPPING_PRICE,
      variantCostPrice: UNIT_COST,
      currency: 'USD',
    });
    admin = await createAdminUser(app, fixture.organizationId, fixture.storeId);
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
    await destroyAdminUsers(app, [admin.id]);
  });

  // ─── Driving both books the way they are actually driven ────────────────────

  /** The whole connection round trip, ending with an approved ad account. */
  async function connect(
    accountCurrency = 'USD',
    platform: AdPlatform = 'meta',
  ): Promise<string> {
    const res = await admin.client
      .post(`/ad-platforms/${platform}/connect`)
      .expect(201);
    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = new URL(
      decodeURIComponent(new URL(approvalUrl).searchParams.get('return') ?? ''),
    );

    const { providerRef } = provider.begun[provider.begun.length - 1];
    provider.approve(providerRef, platform, { currency: accountCurrency });

    await request(app.getHttpServer())
      .get(`${returnUrl.pathname}${returnUrl.search}`)
      .expect(302);

    return providerRef;
  }

  /** What the platform will say about one ad on one day. */
  function platformReports(
    providerRef: string,
    figures: {
      externalAdId: string;
      currency?: string;
      spend?: number;
      reportedRevenue?: number;
      conversions?: number;
      attributionWindow?: AdTree['attributionWindow'];
    },
  ): void {
    provider.setAdTree(providerRef, 'meta', {
      currency: figures.currency ?? 'USD',
      // `in` rather than `??`, because an explicit null is a case here — a
      // platform that states no window — and `??` would silently hand it the
      // default, passing the one test written to catch exactly that.
      attributionWindow:
        'attributionWindow' in figures
          ? figures.attributionWindow!
          : { clickDays: 7, viewDays: 1 },
      ads: [
        {
          externalAdId: figures.externalAdId,
          name: 'Summer reel',
          creativeUrl: null,
          startsAt: null,
          endsAt: null,
          platformState: null,
          placement: null,
          days: [
            {
              day: today(),
              spend: figures.spend ?? THEIR_SPEND,
              impressions: 12_000,
              clicks: 340,
              conversions: figures.conversions ?? 9,
              reportedRevenue: figures.reportedRevenue ?? THEIR_REVENUE,
              reportedRoasBp: null,
            },
          ],
        },
      ],
    });
  }

  /**
   * A campaign with one ad already claiming a platform ad, built through the
   * ordinary admin routes so the tag derivation and its canonical
   * `utm_content` rule are the real ones.
   */
  async function claimedAd(externalId: string): Promise<{
    campaignId: string;
    campaignTag: string;
    adId: string;
    adTag: string;
  }> {
    const campaign = (
      await admin.client
        .post('/campaigns', { name: 'Summer Sale 2026', platform: 'meta' })
        .expect(201)
    ).body as { id: string; tag: string };
    const ad = (
      await admin.client
        .post(`/campaigns/${campaign.id}/ads`, {
          name: 'Summer reel',
          externalId,
        })
        .expect(201)
    ).body as { id: string; tag: string };

    return {
      campaignId: campaign.id,
      campaignTag: campaign.tag,
      adId: ad.id,
      adTag: ad.tag,
    };
  }

  /** The cost price behind the goods, set the way the ad-revenue spec sets it. */
  async function setCostPrice(costPrice: number | null): Promise<void> {
    await db
      .update(productVariants)
      .set({ costPrice })
      .where(eq(productVariants.id, fixture.variantId));
  }

  /** One realized sale credited to this ad: cart → item → checkout → paid. */
  async function placeOrder(campaignTag: string, adTag: string): Promise<void> {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, {
      attribution: {
        lastTouch: { utmCampaign: campaignTag, utmContent: adTag },
      },
    });

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

    await admin.client
      .patch(`/orders/${result.orderId}/status`, { status: 'paid' })
      .expect(200);
  }

  /** What the merchant typed in themselves, against this one creative. */
  async function recordOurSpend(
    campaignId: string,
    adId: string,
    amount = OUR_SPEND,
  ): Promise<void> {
    await admin.client
      .post(`/campaigns/${campaignId}/ads/${adId}/spend`, {
        day: today(),
        amount,
        currency: 'USD',
        // Pinned, so the sync meets it and stands down: this test is about two
        // books disagreeing, and an unpinned day would let the sync overwrite
        // ours with theirs and leave nothing to disagree.
        pinned: true,
      })
      .expect(201);
  }

  const syncNow = async (): Promise<void> => {
    await admin.client.post('/ad-platforms/meta/sync').expect(201);
  };

  const readReport = async (): Promise<AttributedRevenueReport> => {
    const res = await admin.client
      .get('/marketing/attributed-revenue?period=30d&touch=last')
      .expect(200);
    return res.body as AttributedRevenueReport;
  };

  const adLine = async (
    campaignId: string,
    adId: string,
  ): Promise<{ report: AttributedRevenueReport; line: AdRevenueLine }> => {
    const report = await readReport();
    const campaign = report.campaigns.find((c) => c.campaignId === campaignId)!;
    return { report, line: campaign.ads.find((a) => a.adId === adId)! };
  };

  /**
   * The whole starting position: one creative, one real sale, our own spend
   * pinned against it, and a platform reporting quite different figures for the
   * same day.
   */
  async function bothBooks(
    accountCurrency = 'USD',
  ): Promise<{ campaignId: string; adId: string }> {
    const providerRef = await connect(accountCurrency);
    const { campaignId, campaignTag, adId, adTag } =
      await claimedAd('ad_meta_1');

    await placeOrder(campaignTag, adTag);
    await recordOurSpend(campaignId, adId);

    platformReports(providerRef, {
      externalAdId: 'ad_meta_1',
      currency: accountCurrency,
    });
    await syncNow();

    return { campaignId, adId };
  }

  // ─── Both numbers, from one read ────────────────────────────────────────────

  describe('what one read comes back with', () => {
    it('carries our figures and the platform’s, each labelled with its source', async () => {
      const { campaignId, adId } = await bothBooks();
      const { report, line } = await adLine(campaignId, adId);

      // Ours: one real sale, the spend we recorded, and the ratio between them.
      expect(line.orders).toBe(1);
      expect(line.revenue).toBe(ORDER_TOTAL);
      expect(line.spend).toBe(OUR_SPEND);
      expect(line.roas).toBe(2.1); // 105_00 / 50_00

      // Theirs: a different spend, a different revenue, and a different ratio —
      // arriving in its own object, under the name of the platform that said it.
      expect(line.reported).toHaveLength(1);
      const [reported] = line.reported;
      expect(reported.platform).toBe('meta');
      expect(reported.spend).toBe(THEIR_SPEND);
      expect(reported.revenue).toBe(THEIR_REVENUE);
      expect(reported.roas).toBeCloseTo(8.42, 2); // 400_00 / 47_50

      // And the two windows, one against each figure, which is the whole
      // explanation for why a merchant is looking at 2.1x and 8.42x for the
      // same creative on the same day.
      expect(report.lookbackDays).toBeGreaterThan(0);
      expect(reported.attribution).toEqual({ clickDays: 7, viewDays: 1 });
    });

    it('never hands back a platform figure without naming its source', async () => {
      const { campaignId, adId } = await bothBooks();
      const { line } = await adLine(campaignId, adId);

      for (const reported of line.reported) {
        expect(reported.platform).toBeTruthy();
        expect(reported.currency).toBeTruthy();
        expect(reported.syncedAt).toBeTruthy();
      }

      // The converse, which is the half that actually goes wrong: no reported
      // figure has leaked onto the line itself, where it would be unlabelled
      // and indistinguishable from one of ours.
      expect(line.revenue).not.toBe(THEIR_REVENUE);
      expect(line.spend).not.toBe(THEIR_SPEND);
      expect(Object.keys(line)).not.toContain('reportedRevenue');
    });

    it('says the platform stated no window rather than borrowing ours', async () => {
      const providerRef = await connect();
      const { campaignId, adId } = await claimedAd('ad_meta_1');
      platformReports(providerRef, {
        externalAdId: 'ad_meta_1',
        attributionWindow: null,
      });
      await syncNow();

      const { report, line } = await adLine(campaignId, adId);

      // Absent, not defaulted. Our own lookback window printed against their
      // figure would read as a window they agreed to, which would turn the one
      // number that explains the gap into a second thing to distrust.
      expect(line.reported[0].attribution).toBeNull();
      expect(report.lookbackDays).toBeGreaterThan(0);
    });

    it('leaves an ad no platform reports on with nothing at all', async () => {
      // Every ad on a platform no sync covers, permanently — an email or SMS
      // campaign's creatives will never have one of these.
      const { campaignId, adId } = await claimedAd('ad_meta_never_synced');
      const { line } = await adLine(campaignId, adId);

      expect(line.reported).toEqual([]);
      // And the card it feeds still has every figure it had before.
      expect(line.orders).toBe(0);
      expect(line.revenue).toBe(0);
      expect(line.roas).toBeNull();
    });
  });

  // ─── Ours are not touched ───────────────────────────────────────────────────

  describe('our own figures', () => {
    it('are identical before and after the platform ever reported anything', async () => {
      const providerRef = await connect();
      const { campaignId, campaignTag, adId, adTag } =
        await claimedAd('ad_meta_1');

      await placeOrder(campaignTag, adTag);
      await recordOurSpend(campaignId, adId);

      const before = (await adLine(campaignId, adId)).line;

      platformReports(providerRef, { externalAdId: 'ad_meta_1' });
      await syncNow();

      const after = (await adLine(campaignId, adId)).line;

      // Every figure of ours, compared as a whole rather than one at a time, so
      // a field added later cannot quietly start moving.
      const { reported: _theirs, ...oursAfter } = after;
      const { reported: _none, ...oursBefore } = before;
      expect(oursAfter).toEqual(oursBefore);
      expect(after.reported).toHaveLength(1);
    });

    it('does not let a platform’s revenue fill in for one of ours that is missing', async () => {
      // The temptation this rejects: an ad with no tagged link earns nothing
      // here and a fortune there, and substituting theirs would make the card
      // look right and the revenue total incomparable with itself.
      const providerRef = await connect();
      const { campaignId, adId } = await claimedAd('ad_meta_1');
      platformReports(providerRef, {
        externalAdId: 'ad_meta_1',
        reportedRevenue: 900_00,
      });
      await syncNow();

      const { line } = await adLine(campaignId, adId);

      expect(line.orders).toBe(0);
      expect(line.revenue).toBe(0);
      expect(line.reported[0].revenue).toBe(900_00);
    });
  });

  // ─── Contribution Margin stays honest ───────────────────────────────────────

  describe('contribution margin', () => {
    it('is unchanged by a reported revenue of any size', async () => {
      const providerRef = await connect();
      const { campaignId, campaignTag, adId, adTag } =
        await claimedAd('ad_meta_1');

      await placeOrder(campaignTag, adTag);
      await recordOurSpend(campaignId, adId);

      // Worked out by hand: goods 100_00, no discount, cost 40_00, our spend
      // 50_00. Nothing the platform says appears anywhere in that sum.
      const expectedMargin = ORDER_GOODS - 0 - UNIT_COST - OUR_SPEND;

      const before = (await adLine(campaignId, adId)).line;
      expect(before.contributionMargin).toBe(expectedMargin);

      // Now a platform claiming an order of magnitude more revenue than the
      // store actually took. A margin built on a conversion value has no cost
      // basis behind it, so it must move this figure by exactly nothing.
      platformReports(providerRef, {
        externalAdId: 'ad_meta_1',
        reportedRevenue: 5_000_00,
      });
      await syncNow();

      const after = (await adLine(campaignId, adId)).line;
      expect(after.contributionMargin).toBe(expectedMargin);
      expect(after.goodsRevenue).toBe(ORDER_GOODS);
      expect(after.cost).toBe(UNIT_COST);
      expect(after.revenueWithCost).toBe(ORDER_GOODS);
      expect(after.costCoveragePct).toBe(100);
      expect(after.reported[0].revenue).toBe(5_000_00);
    });

    it('stays refused where no cost is known, however much the platform reports', async () => {
      const providerRef = await connect();
      const { campaignId, campaignTag, adId, adTag } =
        await claimedAd('ad_meta_1');

      // An uncosted variant: goods sold, no cost price behind any of them.
      await setCostPrice(null);
      await placeOrder(campaignTag, adTag);

      platformReports(providerRef, {
        externalAdId: 'ad_meta_1',
        reportedRevenue: 5_000_00,
      });
      await syncNow();

      const { line } = await adLine(campaignId, adId);

      // Null, not a number built from the platform's revenue. The blank is what
      // sends a merchant to enter their cost prices; a figure here would look
      // like a triumph and be somebody else's arithmetic.
      expect(line.contributionMargin).toBeNull();
      expect(line.reported[0].revenue).toBe(5_000_00);
    });
  });

  // ─── The currency mismatch ──────────────────────────────────────────────────

  describe('an ad account in another currency', () => {
    it('shows the platform’s figure in its own currency and combines nothing', async () => {
      const { campaignId, adId } = await bothBooks('EUR');
      const { line } = await adLine(campaignId, adId);

      const [reported] = line.reported;
      expect(reported.currency).toBe('EUR');
      expect(reported.storeCurrency).toBe('USD');
      // The mismatch is stated on the figure itself, so a renderer cannot show
      // the number without being told it does not combine.
      expect(reported.matchesStoreCurrency).toBe(false);
      // Stored and returned as exactly what the platform said. No rate is
      // fetched, inferred or hard-coded anywhere in this feature (ADR-0005).
      expect(reported.spend).toBe(THEIR_SPEND);
      expect(reported.revenue).toBe(THEIR_REVENUE);
    });

    it('yields no combined ratio anywhere on the line', async () => {
      const { campaignId, adId } = await bothBooks('EUR');
      const { line } = await adLine(campaignId, adId);
      const [reported] = line.reported;

      // Our ROAS is ours: our revenue over the spend *we* recorded, in USD. The
      // EUR figure is not in it, and no ratio on this line divides one currency
      // by the other.
      expect(line.revenue).toBe(ORDER_TOTAL);
      expect(line.spend).toBe(OUR_SPEND);
      expect(line.roas).toBe(2.1);

      // Theirs is theirs: EUR over EUR, which crosses nothing.
      expect(reported.roas).toBeCloseTo(8.42, 2);

      // And the number that must not exist — ours over theirs, or theirs over
      // ours — appears nowhere.
      const crossed = ORDER_TOTAL / THEIR_SPEND;
      expect(line.roas).not.toBeCloseTo(crossed, 2);
      expect(reported.roas).not.toBeCloseTo(crossed, 2);
    });

    it('computes no contribution margin from the foreign figure', async () => {
      const { campaignId, adId } = await bothBooks('EUR');
      const { line } = await adLine(campaignId, adId);

      // Our own margin, from our own spend in our own currency, exactly as it
      // would read with no platform connected at all.
      expect(line.contributionMargin).toBe(
        ORDER_GOODS - 0 - UNIT_COST - OUR_SPEND,
      );
      expect(line.reported[0].matchesStoreCurrency).toBe(false);
    });

    it('keeps the foreign figure out of the merchant’s own spend', async () => {
      // The sync already refuses to write a EUR figure into a book summed as
      // one currency. Asserted here too, because it is the other half of the
      // same promise: the figure is visible and it is not in our total.
      const { campaignId, adId } = await bothBooks('EUR');
      const { line } = await adLine(campaignId, adId);

      expect(line.spend).toBe(OUR_SPEND);
      expect(line.spend).not.toBe(OUR_SPEND + THEIR_SPEND);
    });
  });

  // ─── Scoping ────────────────────────────────────────────────────────────────

  describe('scoping', () => {
    it('keeps one store’s reported figures off another store’s card', async () => {
      const other = await seedStorefront(app, { currency: 'USD' });
      const otherAdmin = await createAdminUser(
        app,
        other.organizationId,
        other.storeId,
      );

      try {
        await bothBooks();

        // The other organization's store claims a platform ad with the same id
        // — a platform ad id is the vendor's namespace, not ours.
        const campaign = (
          await otherAdmin.client
            .post('/campaigns', { name: 'Theirs', platform: 'meta' })
            .expect(201)
        ).body as { id: string };
        const ad = (
          await otherAdmin.client
            .post(`/campaigns/${campaign.id}/ads`, {
              name: 'Theirs',
              externalId: 'ad_meta_1',
            })
            .expect(201)
        ).body as { id: string };

        const res = await otherAdmin.client
          .get('/marketing/attributed-revenue?period=30d&touch=last')
          .expect(200);
        const report = res.body as AttributedRevenueReport;
        const line = report.campaigns
          .find((c) => c.campaignId === campaign.id)!
          .ads.find((a) => a.adId === ad.id)!;

        expect(line.reported).toEqual([]);
      } finally {
        await destroyStorefront(app, other.organizationId);
        await destroyAdminUsers(app, [otherAdmin.id]);
      }
    });
  });
});
