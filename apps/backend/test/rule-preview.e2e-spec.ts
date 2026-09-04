/**
 * The matching-rule preview, end to end.
 *
 * Campaigns resolve at read time (ADR-0001), so a saved rule reshapes reports
 * that have already been read. That is what lets a correction repair the past,
 * and it is what lets a careless rule quietly rewrite it. The preview exists to
 * make that consequence visible while the rule is still a draft.
 *
 * The seam runs the whole length of the claim and never mocks the middle:
 * sales arrive through the public storefront GraphQL API carrying real UTM
 * tags, are advanced to `paid` through the real admin status endpoint, and the
 * preview is read back through the admin REST API against local Postgres.
 *
 * The assertion that matters most is the last block: for each shape of rule,
 * the preview is read, the rule is then actually saved, and the attributed
 * revenue report is required to say what the preview said it would.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './helpers/test-app';
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

const VARIANT_PRICE = 2500;
const SHIPPING_PRICE = 500;
/** What one seeded order is worth, in the smallest currency unit. */
const ORDER_TOTAL = VARIANT_PRICE + SHIPPING_PRICE;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

/** A user agent the ingest classifier recognises as a crawler. */
const CRAWLER_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

interface RevenueBucket {
  orders: number;
  revenue: number;
}

interface PreviewOverlap {
  campaignId: string;
  name: string;
  tag: string;
  status: string;
  taken: RevenueBucket;
  blocked: RevenueBucket;
}

interface PreviewSampleOrder {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  total: number;
  currentCampaignId: string | null;
  currentCampaignName: string | null;
  matchedValue: string | null;
}

interface RulePreviewReport {
  campaignId: string;
  campaignName: string;
  rule: {
    field: string;
    operator: string;
    value: string;
    normalizedValue: string;
  };
  duplicate: boolean;
  period: string;
  touch: 'first' | 'last';
  lookbackDays: number;
  rangeStart: string;
  rangeEnd: string;
  claimed: RevenueBucket;
  fromUnattributed: RevenueBucket;
  overlaps: PreviewOverlap[];
  campaignBefore: RevenueBucket;
  campaignAfter: RevenueBucket;
  totals: RevenueBucket;
  sampleLimit: number;
  samples: PreviewSampleOrder[];
}

interface CampaignRevenueLine extends RevenueBucket {
  campaignId: string;
}

interface AttributedRevenueReport {
  campaigns: CampaignRevenueLine[];
  unattributed: RevenueBucket;
  totals: RevenueBucket;
}

interface Touch {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  occurredAt?: string;
}

interface Candidate {
  field: string;
  operator: string;
  value: string;
}

const EMPTY: RevenueBucket = { orders: 0, revenue: 0 };

describe('Matching-rule preview (e2e)', () => {
  let app: INestApplication<App>;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;

  beforeAll(async () => {
    ({ app } = await createTestApp());
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

  /**
   * Places one realized sale: cart → item → checkout → paid. Advanced through
   * the admin status endpoint rather than written directly, because `pending`
   * is not revenue and the preview counts what the report counts.
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

  async function createCampaign(
    name: string,
    as: AdminUserFixture = admin,
  ): Promise<{ id: string; tag: string; name: string }> {
    const res = await as.client
      .post('/campaigns', { name, platform: 'meta' })
      .expect(201);
    return res.body as { id: string; tag: string; name: string };
  }

  function previewUrl(campaignId: string, rule: Candidate, touch = 'last') {
    const params = new URLSearchParams({
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
      period: '30d',
      touch,
    });
    return `/campaigns/${campaignId}/rules/preview?${params.toString()}`;
  }

  async function readPreview(
    campaignId: string,
    rule: Candidate,
    touch = 'last',
    as: AdminUserFixture = admin,
  ): Promise<RulePreviewReport> {
    const res = await as.client
      .get(previewUrl(campaignId, rule, touch))
      .expect(200);
    return res.body as RulePreviewReport;
  }

  async function saveRule(campaignId: string, rule: Candidate): Promise<void> {
    await admin.client.post(`/campaigns/${campaignId}/rules`, rule).expect(201);
  }

  async function readRevenue(touch = 'last'): Promise<AttributedRevenueReport> {
    const res = await admin.client
      .get(`/marketing/attributed-revenue?period=30d&touch=${touch}`)
      .expect(200);
    return res.body as AttributedRevenueReport;
  }

  const revenueFor = (report: AttributedRevenueReport, campaignId: string) =>
    report.campaigns.find((c) => c.campaignId === campaignId) ?? EMPTY;

  async function trackEvent(sessionId: string, userAgent: string) {
    await request(app.getHttpServer())
      .post('/api/events')
      .set('X-API-Key', fixture.apiKey)
      .set('User-Agent', userAgent)
      .send({ events: [{ type: 'page_view', sessionId, path: '/' }] })
      .expect(202);
  }

  // ─── What the rule would claim ──────────────────────────────────────────────

  it('reports the orders and revenue a candidate rule would claim', async () => {
    const summer = await createCampaign('Summer Sale');

    // Two links that went out tagged by hand, plus a direct arrival.
    await placeOrder({ lastTouch: { utmSource: 'instagram' } });
    await placeOrder({ lastTouch: { utmSource: 'Instagram' } });
    await placeOrder();

    const preview = await readPreview(summer.id, {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    });

    // One rule covers both spellings — matching normalizes each side.
    expect(preview.claimed).toEqual({ orders: 2, revenue: ORDER_TOTAL * 2 });
    expect(preview.fromUnattributed).toEqual({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });
    // The scale to judge it against: two of the period's three orders.
    expect(preview.totals).toEqual({ orders: 3, revenue: ORDER_TOTAL * 3 });
    expect(preview.campaignBefore).toEqual(EMPTY);
    expect(preview.campaignAfter).toEqual({
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });
  });

  it('names the orders it would claim, with what they carried', async () => {
    const summer = await createCampaign('Summer Sale');
    const orderId = await placeOrder({
      lastTouch: { utmSource: 'Instagram' },
    });

    const preview = await readPreview(summer.id, {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    });

    expect(preview.samples).toHaveLength(1);
    expect(preview.samples[0]).toMatchObject({
      orderId,
      total: ORDER_TOTAL,
      currentCampaignId: null,
      currentCampaignName: null,
      // The order's own value, not the rule's — an over-broad rule is obvious
      // when the values it swallowed are on screen.
      matchedValue: 'Instagram',
    });
    expect(preview.samples[0].orderNumber).toBeTruthy();
  });

  it('echoes back the value that would actually be stored and compared', async () => {
    const summer = await createCampaign('Summer Sale');

    const preview = await readPreview(summer.id, {
      field: 'referrer_host',
      operator: 'equals',
      value: 'https://www.instagram.com/p/abc/',
    });

    // A pasted link is reduced to its host on save; the preview says so rather
    // than letting the merchant find out afterwards.
    expect(preview.rule.value).toBe('instagram.com');
    expect(preview.rule.normalizedValue).toBe('instagram-com');
  });

  it('refuses a value that could never match anything', async () => {
    const summer = await createCampaign('Summer Sale');

    await admin.client
      .get(
        previewUrl(summer.id, {
          field: 'utm_source',
          operator: 'equals',
          value: '---',
        }),
      )
      .expect(400);
  });

  it('says when the campaign already has the rule, rather than showing a bare zero', async () => {
    const summer = await createCampaign('Summer Sale');
    await placeOrder({ lastTouch: { utmCampaign: summer.tag } });

    // The canonical rule created with the campaign, re-typed in another casing.
    const preview = await readPreview(summer.id, {
      field: 'utm_campaign',
      operator: 'equals',
      value: summer.tag.replace(/-/g, '_').toUpperCase(),
    });

    expect(preview.duplicate).toBe(true);
    expect(preview.claimed).toEqual(EMPTY);
    // Nothing would change, and the campaign keeps what it already had.
    expect(preview.campaignAfter).toEqual(preview.campaignBefore);
    expect(preview.campaignAfter).toEqual({ orders: 1, revenue: ORDER_TOTAL });
  });

  // ─── Overlaps with other campaigns ──────────────────────────────────────────

  it('shows orders another campaign already claims', async () => {
    const summer = await createCampaign('Summer Sale');
    const spring = await createCampaign('Spring Sale');

    // Tagged for Spring, and placed through an Instagram link. A broad rule on
    // the source would reach for it — and lose, because a campaign-tag rule
    // outranks a source rule.
    await placeOrder({
      lastTouch: { utmCampaign: spring.tag, utmSource: 'instagram' },
    });
    await placeOrder({ lastTouch: { utmSource: 'instagram' } });

    const preview = await readPreview(summer.id, {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    });

    expect(preview.claimed).toEqual({ orders: 1, revenue: ORDER_TOTAL });

    const overlap = preview.overlaps.find((o) => o.campaignId === spring.id);
    expect(overlap).toMatchObject({
      name: 'Spring Sale',
      tag: spring.tag,
      taken: EMPTY,
      blocked: { orders: 1, revenue: ORDER_TOTAL },
    });
  });

  it('shows revenue a rule would take away from another campaign', async () => {
    // Summer is created first, so it wins a tie on campaign age — which is how
    // a rule can pull orders out of a campaign that already reports them.
    const summer = await createCampaign('Summer Sale');
    const spring = await createCampaign('Spring Sale');

    await placeOrder({ lastTouch: { utmCampaign: spring.tag } });

    const before = await readRevenue();
    expect(revenueFor(before, spring.id)).toMatchObject({ orders: 1 });

    const preview = await readPreview(summer.id, {
      field: 'utm_campaign',
      operator: 'equals',
      value: spring.tag,
    });

    expect(preview.claimed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    expect(preview.fromUnattributed).toEqual(EMPTY);
    expect(preview.overlaps).toHaveLength(1);
    expect(preview.overlaps[0]).toMatchObject({
      campaignId: spring.id,
      name: 'Spring Sale',
      taken: { orders: 1, revenue: ORDER_TOTAL },
      blocked: EMPTY,
    });
  });

  it('shows an over-broad rule reaching across the whole period', async () => {
    const summer = await createCampaign('Summer Sale');
    const spring = await createCampaign('Spring Sale');

    await placeOrder({ lastTouch: { utmMedium: 'paid_social' } });
    await placeOrder({ lastTouch: { utmMedium: 'paid-social' } });
    await placeOrder({
      lastTouch: { utmCampaign: spring.tag, utmMedium: 'paid_social' },
    });

    const preview = await readPreview(summer.id, {
      field: 'utm_medium',
      operator: 'starts_with',
      value: 'paid',
    });

    // Two of three orders move, and the third is visibly someone else's — the
    // merchant can see this rule is claiming the whole period, not a campaign.
    expect(preview.claimed).toEqual({ orders: 2, revenue: ORDER_TOTAL * 2 });
    expect(preview.totals).toEqual({ orders: 3, revenue: ORDER_TOTAL * 3 });
    expect(
      preview.overlaps.find((o) => o.campaignId === spring.id)?.blocked,
    ).toEqual({ orders: 1, revenue: ORDER_TOTAL });
  });

  // ─── A rule cannot claim what no rule could claim ───────────────────────────

  it('does not claim a touch older than the lookback window', async () => {
    const summer = await createCampaign('Summer Sale');

    await placeOrder({
      lastTouch: { utmSource: 'instagram', occurredAt: daysAgo(60) },
    });
    await placeOrder({
      lastTouch: { utmSource: 'instagram', occurredAt: daysAgo(2) },
    });

    const preview = await readPreview(summer.id, {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    });

    expect(preview.lookbackDays).toBe(30);
    expect(preview.claimed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    // The old visit's money is still real, and still in the total.
    expect(preview.totals).toEqual({ orders: 2, revenue: ORDER_TOTAL * 2 });
  });

  it('does not claim bot traffic', async () => {
    const summer = await createCampaign('Summer Sale');
    const botSession = 'session-preview-crawler';

    await placeOrder({
      lastTouch: { utmSource: 'instagram' },
      sessionId: botSession,
    });
    await trackEvent(botSession, CRAWLER_UA);

    const preview = await readPreview(summer.id, {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    });

    expect(preview.claimed).toEqual(EMPTY);
    expect(preview.totals).toEqual({ orders: 1, revenue: ORDER_TOTAL });
  });

  it('previews the touch it is asked about', async () => {
    const summer = await createCampaign('Summer Sale');

    await placeOrder({
      firstTouch: { utmSource: 'instagram', occurredAt: daysAgo(7) },
      lastTouch: { utmSource: 'newsletter', occurredAt: daysAgo(1) },
    });

    const rule = {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    };

    expect((await readPreview(summer.id, rule, 'first')).claimed).toEqual({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect((await readPreview(summer.id, rule, 'last')).claimed).toEqual(EMPTY);
  });

  // ─── Previewing changes nothing ─────────────────────────────────────────────

  it('creates no rule and alters no report', async () => {
    const summer = await createCampaign('Summer Sale');
    await placeOrder({ lastTouch: { utmSource: 'instagram' } });

    const rulesBefore = await admin.client
      .get(`/campaigns/${summer.id}/rules`)
      .expect(200);
    const revenueBefore = await readRevenue();

    const rule = {
      field: 'utm_source',
      operator: 'equals',
      value: 'instagram',
    };
    await readPreview(summer.id, rule);
    await readPreview(summer.id, rule);

    const rulesAfter = await admin.client
      .get(`/campaigns/${summer.id}/rules`)
      .expect(200);
    const revenueAfter = await readRevenue();

    // Only the campaign's own canonical rule, exactly as before.
    expect((rulesAfter.body as unknown[]).length).toBe(
      (rulesBefore.body as unknown[]).length,
    );
    expect(revenueAfter.campaigns).toEqual(revenueBefore.campaigns);
    expect(revenueAfter.unattributed).toEqual(revenueBefore.unattributed);
  });

  // ─── The promise the preview makes ──────────────────────────────────────────

  describe('saving the previewed rule produces the figures it showed', () => {
    it('for a rule claiming unattributed orders', async () => {
      const summer = await createCampaign('Summer Sale');
      await placeOrder({ lastTouch: { utmSource: 'instagram' } });
      await placeOrder({ lastTouch: { utmSource: 'INSTAGRAM' } });
      await placeOrder();

      const rule = {
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
      };
      const preview = await readPreview(summer.id, rule);
      await saveRule(summer.id, rule);
      const report = await readRevenue();

      expect(revenueFor(report, summer.id)).toMatchObject(
        preview.campaignAfter,
      );
      expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
      expect(report.totals).toEqual(preview.totals);
    });

    it('for a rule taking orders from another campaign', async () => {
      const summer = await createCampaign('Summer Sale');
      const spring = await createCampaign('Spring Sale');
      await placeOrder({ lastTouch: { utmCampaign: spring.tag } });

      const rule = {
        field: 'utm_campaign',
        operator: 'equals',
        value: spring.tag,
      };
      const preview = await readPreview(summer.id, rule);
      await saveRule(summer.id, rule);
      const report = await readRevenue();

      expect(revenueFor(report, summer.id)).toMatchObject(
        preview.campaignAfter,
      );
      // And the campaign the preview named as losing it, actually lost it.
      expect(revenueFor(report, spring.id)).toMatchObject(EMPTY);
      expect(preview.overlaps[0]).toMatchObject({
        campaignId: spring.id,
        taken: { orders: 1, revenue: ORDER_TOTAL },
      });
    });

    it('for a rule a higher-precedence rule blocks', async () => {
      const summer = await createCampaign('Summer Sale');
      const spring = await createCampaign('Spring Sale');
      await placeOrder({
        lastTouch: { utmCampaign: spring.tag, utmSource: 'instagram' },
      });
      await placeOrder({ lastTouch: { utmSource: 'instagram' } });

      const rule = {
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
      };
      const preview = await readPreview(summer.id, rule);
      await saveRule(summer.id, rule);
      const report = await readRevenue();

      // The blocked order stayed where the preview said it would.
      expect(revenueFor(report, summer.id)).toMatchObject(
        preview.campaignAfter,
      );
      expect(revenueFor(report, spring.id)).toMatchObject({
        orders: 1,
        revenue: ORDER_TOTAL,
      });
    });

    it('for a rule that claims nothing', async () => {
      const summer = await createCampaign('Summer Sale');
      await placeOrder({ lastTouch: { utmSource: 'instagram' } });

      const rule = {
        field: 'utm_source',
        operator: 'equals',
        value: 'pinterest',
      };
      const preview = await readPreview(summer.id, rule);
      expect(preview.claimed).toEqual(EMPTY);

      await saveRule(summer.id, rule);
      const report = await readRevenue();

      expect(revenueFor(report, summer.id)).toMatchObject(
        preview.campaignAfter,
      );
      expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    });
  });

  // ─── Tenancy ────────────────────────────────────────────────────────────────

  it('never previews against another organization traffic', async () => {
    const summer = await createCampaign('Summer Sale');

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
      const otherSummer = await createCampaign('Summer Sale', otherAdmin);
      // Same name, so the same canonical tag — and still not the same campaign.
      expect(otherSummer.tag).toBe(summer.tag);

      // Only the other merchant has a sale in this period.
      await placeOrder(
        { lastTouch: { utmSource: 'instagram' } },
        other,
        otherAdmin,
      );

      const rule = {
        field: 'utm_source',
        operator: 'equals',
        value: 'instagram',
      };

      const mine = await readPreview(summer.id, rule);
      expect(mine.claimed).toEqual(EMPTY);
      expect(mine.totals).toEqual(EMPTY);

      const theirs = await readPreview(
        otherSummer.id,
        rule,
        'last',
        otherAdmin,
      );
      expect(theirs.claimed).toEqual({ orders: 1, revenue: ORDER_TOTAL });

      // And neither merchant can even name the other's campaign.
      await admin.client.get(previewUrl(otherSummer.id, rule)).expect(404);
    } finally {
      await destroyStorefront(app, other.organizationId);
      await destroyAdminUsers(app, [otherAdmin.id]);
    }
  });
});
