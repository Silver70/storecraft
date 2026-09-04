/**
 * Attributed revenue by Campaign, end to end — the question the whole
 * attribution feature exists to answer.
 *
 * The seam runs the full length of the claim: a sale arrives through the public
 * storefront GraphQL API carrying the UTM tags a visitor landed with, and the
 * merchant reads the money back through the admin REST API, resolved onto the
 * Campaign that earned it. Everything between is the real application against a
 * local Postgres database.
 *
 * Attribution is resolved at read time (ADR-0001), and most of what is asserted
 * here is what that buys: a Campaign created after its ads already ran claims
 * their Orders, a matching rule added today repairs yesterday's report, and
 * switching between First and Last Touch is a different answer from the same
 * rows rather than a migration.
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

/** A user agent the ingest classifier recognises as a crawler. */
const CRAWLER_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

interface RevenueBucket {
  orders: number;
  revenue: number;
}

interface CampaignRevenueLine extends RevenueBucket {
  campaignId: string;
  name: string;
  tag: string;
  status: string;
}

interface AttributedRevenueReport {
  period: string;
  touch: 'first' | 'last';
  lookbackDays: number;
  rangeStart: string;
  rangeEnd: string;
  campaigns: CampaignRevenueLine[];
  unattributed: RevenueBucket;
  totals: RevenueBucket;
}

interface Touch {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  landingPath?: string;
  occurredAt?: string;
}

describe('Attributed revenue by campaign (e2e)', () => {
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

  // ─── Driving the real APIs ──────────────────────────────────────────────────

  /**
   * Places one realized sale: cart → item → checkout → paid.
   *
   * The order is advanced through the admin status endpoint rather than written
   * directly, because `pending` is not revenue — the report has to count the
   * same four statuses the sales reports do, and a test that skipped the
   * transition would never notice if it stopped.
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

  async function readReport(
    touch: 'first' | 'last' = 'last',
    as: AdminUserFixture = admin,
  ): Promise<AttributedRevenueReport> {
    const res = await as.client
      .get(`/marketing/attributed-revenue?period=30d&touch=${touch}`)
      .expect(200);
    return res.body as AttributedRevenueReport;
  }

  const lineFor = (report: AttributedRevenueReport, campaignId: string) =>
    report.campaigns.find((c) => c.campaignId === campaignId);

  /** Sends one event through the public ingest API under the given user agent. */
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

  // ─── The report ─────────────────────────────────────────────────────────────

  it('reports revenue and order count per campaign, with unattributed on its own line', async () => {
    const summer = await createCampaign('Summer Sale');

    // Two sales from the campaign's own tag, spelled the way a hand-tagged
    // link often is, plus one visitor who arrived with nothing.
    await placeOrder({ lastTouch: { utmCampaign: summer.tag } });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag.replace(/-/g, '_').toUpperCase() },
    });
    await placeOrder();

    const report = await readReport();

    expect(lineFor(report, summer.id)).toMatchObject({
      name: 'Summer Sale',
      tag: summer.tag,
      orders: 2,
      revenue: ORDER_TOTAL * 2,
    });

    // Its own line, never folded into the campaign above it.
    expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    expect(report.totals).toEqual({ orders: 3, revenue: ORDER_TOTAL * 3 });

    // Revenue is the smallest currency unit, unformatted — no symbol, no
    // decimal point, nothing a caller would have to parse back.
    const revenue = lineFor(report, summer.id)!.revenue;
    expect(typeof revenue).toBe('number');
    expect(Number.isInteger(revenue)).toBe(true);
  });

  it('shows the active lookback window alongside the figures', async () => {
    const report = await readReport();

    // The reason these numbers differ from what an ad platform reports.
    expect(report.lookbackDays).toBe(30);
    expect(new Date(report.rangeEnd).getTime()).toBeGreaterThan(
      new Date(report.rangeStart).getTime(),
    );
  });

  it('switches between first and last touch without touching any data', async () => {
    const discovery = await createCampaign('Discovery Push');
    const closer = await createCampaign('Retargeting Push');

    await placeOrder({
      firstTouch: { utmCampaign: discovery.tag, occurredAt: daysAgo(7) },
      lastTouch: { utmCampaign: closer.tag, occurredAt: daysAgo(1) },
    });

    const byFirst = await readReport('first');
    expect(lineFor(byFirst, discovery.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(lineFor(byFirst, closer.id)).toMatchObject({ orders: 0 });

    // Same order, same row, no migration between the two reads.
    const byLast = await readReport('last');
    expect(lineFor(byLast, closer.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(lineFor(byLast, discovery.id)).toMatchObject({ orders: 0 });
  });

  it('lets a campaign created after its orders claim them', async () => {
    // The merchant ran the ad first and set the campaign up afterwards, which
    // is the ordinary case and must not lose the revenue.
    await placeOrder({ lastTouch: { utmCampaign: 'flash_friday' } });

    const before = await readReport();
    expect(before.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });

    const flash = await createCampaign('Flash Friday');
    const after = await readReport();

    expect(lineFor(after, flash.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(after.unattributed).toEqual({ orders: 0, revenue: 0 });
  });

  it('repairs historical figures when a matching rule is added', async () => {
    const summer = await createCampaign('Summer Sale');

    // Links that went out tagged with a spelling the canonical tag does not
    // cover — no separator at all, so normalization alone cannot reach it.
    await placeOrder({ lastTouch: { utmCampaign: 'summersale' } });

    const before = await readReport();
    expect(lineFor(before, summer.id)).toMatchObject({ orders: 0, revenue: 0 });
    expect(before.unattributed.orders).toBe(1);

    await admin.client
      .post(`/campaigns/${summer.id}/rules`, {
        field: 'utm_campaign',
        operator: 'equals',
        value: 'summersale',
      })
      .expect(201);

    // The order is not rewritten; the report simply reads it differently.
    const after = await readReport();
    expect(lineFor(after, summer.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(after.unattributed).toEqual({ orders: 0, revenue: 0 });
  });

  it('denies credit to a touch older than the lookback window', async () => {
    const summer = await createCampaign('Summer Sale');

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, occurredAt: daysAgo(60) },
    });
    await placeOrder({
      lastTouch: { utmCampaign: summer.tag, occurredAt: daysAgo(2) },
    });

    const report = await readReport();

    // The old visit happened; it did not drive today's sale.
    expect(lineFor(report, summer.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
    expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    expect(report.totals.orders).toBe(2);
  });

  it('never lets bot traffic appear to have driven a sale', async () => {
    const summer = await createCampaign('Summer Sale');
    const botSession = 'session-crawler';

    await placeOrder({
      lastTouch: { utmCampaign: summer.tag },
      sessionId: botSession,
    });
    // The crawler's own visit, classified server-side from its user agent
    // exactly as every other event is.
    await trackEvent(botSession, CRAWLER_UA);

    const report = await readReport();

    expect(lineFor(report, summer.id)).toMatchObject({ orders: 0, revenue: 0 });
    // The money is still real and still counted — it just has no campaign.
    expect(report.unattributed).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    expect(report.totals).toEqual({ orders: 1, revenue: ORDER_TOTAL });
  });

  it('reconciles with the sales reporting for the same period', async () => {
    const summer = await createCampaign('Summer Sale');

    await placeOrder({ lastTouch: { utmCampaign: summer.tag } });
    await placeOrder();
    // A cart that never becomes revenue: checked out but left pending, so it
    // must not appear in either report.
    const { createCart: pendingCart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, {});
    await fixture.storefront.query(ADD_TO_CART, {
      cartId: pendingCart.id,
      variantId: fixture.variantId,
      quantity: 1,
    });
    await fixture.storefront.query(CHECKOUT, {
      cartId: pendingCart.id,
      input: {
        shippingMethodId: fixture.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'ada@example.test',
      },
    });

    const report = await readReport();

    const stats = await admin.client
      .get('/dashboard/stats?period=30d')
      .expect(200);
    const { revenue } = stats.body as { revenue: { current: number } };

    // The dashboard's own order metric counts orders *placed*, pending ones
    // included; analytics counts the realized ones, which is what revenue is
    // made of and what this report has to agree with.
    const traffic = await admin.client
      .get('/analytics/traffic?period=30d')
      .expect(200);
    const { orders: realizedOrders } = traffic.body as { orders: number };

    expect(report.totals.revenue).toBe(revenue.current);
    expect(report.totals.orders).toBe(realizedOrders);
    expect(report.totals.orders).toBe(2);

    const attributed = report.campaigns.reduce((sum, c) => sum + c.revenue, 0);
    expect(attributed + report.unattributed.revenue).toBe(
      report.totals.revenue,
    );
  });

  it('never credits one organization traffic from another', async () => {
    const summer = await createCampaign('Summer Sale');

    // A second merchant running a campaign of the same name, whose links carry
    // the same tag. Neither report may show the other's revenue.
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
      expect(otherSummer.tag).toBe(summer.tag);

      await placeOrder({ lastTouch: { utmCampaign: summer.tag } });
      await placeOrder(
        { lastTouch: { utmCampaign: otherSummer.tag } },
        other,
        otherAdmin,
      );

      const mine = await readReport();
      expect(lineFor(mine, summer.id)).toMatchObject({
        orders: 1,
        revenue: ORDER_TOTAL,
      });
      expect(lineFor(mine, otherSummer.id)).toBeUndefined();
      expect(mine.totals).toEqual({ orders: 1, revenue: ORDER_TOTAL });

      const theirs = await readReport('last', otherAdmin);
      expect(lineFor(theirs, otherSummer.id)).toMatchObject({
        orders: 1,
        revenue: ORDER_TOTAL,
      });
      expect(lineFor(theirs, summer.id)).toBeUndefined();
      expect(theirs.totals).toEqual({ orders: 1, revenue: ORDER_TOTAL });
    } finally {
      await destroyStorefront(app, other.organizationId);
      await destroyAdminUsers(app, [otherAdmin.id]);
    }
  });
});
