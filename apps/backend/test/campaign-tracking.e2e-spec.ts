/**
 * Start tracking, end to end: a campaign built in Ads Manager, discovered by
 * the real sync, tagged through the admin API, and then credited with the
 * revenue its clicks drive.
 *
 * The ad platform is the in-memory fake, which keeps each ad's tags. A write
 * lands there, and a later read by the sync or by a second press sees it,
 * exactly as it would at the platform. Everything else is production wiring:
 * the connection flow, the sync, the storefront's checkout and the admin reads.
 *
 * What is asserted is what costs the merchant something. An ad that already
 * carries the tags is never rebuilt again. An ad the platform refuses does not
 * stop the others. A campaign reads Tracked only when every ad carries the
 * tags. A platform failure never reads as success.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { ads, campaigns } from '../src/shared/database/schema';
import type {
  AdTree,
  PlatformSignals,
  ReportedAd,
} from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import type { TrackingOutcome } from '../src/modules/ad-platform/services/campaign-tracking.service';
import type {
  AttributedRevenueReport,
  CampaignPerformanceReport,
} from '../src/modules/marketing/services/attributed-revenue.service';
import {
  buildLinkTags,
  carriesOurLinkTags,
} from '../src/modules/ad-platform/utils/link-tags.util';
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

const VARIANT_PRICE = 2500;
const SHIPPING_PRICE = 500;
const ORDER_TOTAL = VARIANT_PRICE + SHIPPING_PRICE;

// Platform ids, as Meta names a campaign built in Ads Manager and its ads.
const CAMPAIGN_EXT = '120200000000000101';
const REEL_EXT = '120210000000000101';
const STILL_EXT = '120210000000000102';

const DELIVERING: PlatformSignals = {
  delivery: 'active',
  review: 'approved',
  startsAt: null,
  endsAt: null,
};

const reported = (externalAdId: string): ReportedAd => ({
  externalAdId,
  name: `Ad ${externalAdId}`,
  format: 'image',
  creativeUrl: null,
  signals: DELIVERING,
  days: [],
});

/** One campaign built in Ads Manager, with two ads that carry none of our tags. */
const BUILT_ELSEWHERE: AdTree = {
  currency: 'USD',
  complete: true,
  campaigns: [
    {
      externalCampaignId: CAMPAIGN_EXT,
      name: 'Built in Ads Manager',
      signals: DELIVERING,
      ads: [reported(REEL_EXT), reported(STILL_EXT)],
    },
  ],
};

describe('Start tracking a discovered campaign (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;
  const extraUsers: string[] = [];

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
    });
    admin = await createAdminUser(app, fixture.organizationId, fixture.storeId);
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
    await destroyAdminUsers(app, [admin.id, ...extraUsers.splice(0)]);
  });

  // ─── Driving the flow the way a merchant does ───────────────────────────────

  /**
   * Connects Meta through the real round trip. Connecting runs the first sync,
   * which discovers whatever the account holds.
   */
  async function connect(holds: AdTree = BUILT_ELSEWHERE): Promise<void> {
    provider.setAdTree('act_100', holds);

    const res = await admin.client
      .post('/ad-platforms/meta/connect')
      .expect(201);
    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = new URL(
      decodeURIComponent(new URL(approvalUrl).searchParams.get('return') ?? ''),
    );
    const { providerRef } = provider.begun[provider.begun.length - 1];
    provider.approve(providerRef, 'meta', [{ externalAccountId: 'act_100' }]);

    await request(app.getHttpServer())
      .get(`${returnUrl.pathname}${returnUrl.search}`)
      .expect(302);
  }

  async function discovered(): Promise<{
    id: string;
    ads: Record<string, string>;
  }> {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.externalId, CAMPAIGN_EXT));
    const rows = await db
      .select()
      .from(ads)
      .where(eq(ads.campaignId, campaign.id));
    return {
      id: campaign.id,
      ads: Object.fromEntries(rows.map((row) => [row.externalId, row.id])),
    };
  }

  async function startTracking(
    campaignId: string,
    as: AdminUserFixture = admin,
  ): Promise<TrackingOutcome> {
    const res = await as.client
      .post(`/campaigns/${campaignId}/tracking`)
      .expect(200);
    return res.body as TrackingOutcome;
  }

  async function isTracked(campaignId: string): Promise<boolean> {
    const res = await admin.client.get(`/campaigns/${campaignId}`).expect(200);
    return (res.body as { hasLinkTags: boolean }).hasLinkTags;
  }

  const resultFor = (outcome: TrackingOutcome, externalId: string) =>
    outcome.ads.find((ad) => ad.externalId === externalId);

  async function placeOrder(lastTouch?: Record<string, string>): Promise<void> {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, lastTouch ? { attribution: { lastTouch } } : {});
    await fixture.storefront.query(ADD_TO_CART, {
      cartId: cart.id,
      variantId: fixture.variantId,
      quantity: 1,
    });
    const { checkout } = await fixture.storefront.query<{
      checkout: { orderId: string };
    }>(CHECKOUT, {
      cartId: cart.id,
      input: {
        shippingMethodId: fixture.shippingMethodId,
        shippingAddress: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          line1: '1 Analytical Way',
          city: 'Portland',
          state: 'OR',
          postalCode: '97201',
          countryCode: 'US',
        },
        email: 'ada@example.test',
      },
    });
    await admin.client
      .patch(`/orders/${checkout.orderId}/status`, { status: 'paid' })
      .expect(200);
  }

  // ─── The cases ──────────────────────────────────────────────────────────────

  it('writes our tags onto every ad of a Not Tracked campaign, and it reads Tracked', async () => {
    await connect();
    const campaign = await discovered();
    expect(await isTracked(campaign.id)).toBe(false);

    const outcome = await startTracking(campaign.id);

    expect(provider.tagWrites.map((w) => w.externalAdId).sort()).toEqual(
      [REEL_EXT, STILL_EXT].sort(),
    );
    for (const write of provider.tagWrites) {
      expect(write.urlTags).toBe(buildLinkTags());
    }
    expect(outcome).toMatchObject({
      campaignId: campaign.id,
      tracked: true,
      message: null,
    });
    expect(outcome.ads.map((ad) => ad.result)).toEqual(['tagged', 'tagged']);
    expect(await isTracked(campaign.id)).toBe(true);
  });

  it('keeps the parameters the merchant already had on an ad', async () => {
    provider.setLinkTags(REEL_EXT, 'ref=spring&utm_source=facebook');
    await connect();
    const campaign = await discovered();

    await startTracking(campaign.id);

    expect(provider.linkTagsOf(REEL_EXT)).toBe(
      'ref=spring&utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}',
    );
  });

  it('reports an ad the platform will not retag by name and reason, and tags the rest', async () => {
    provider.refuseTagWrite(STILL_EXT, 'cannot_rebuild');
    await connect();
    const campaign = await discovered();

    const outcome = await startTracking(campaign.id);

    expect(resultFor(outcome, REEL_EXT)).toMatchObject({ result: 'tagged' });
    const refused = resultFor(outcome, STILL_EXT);
    expect(refused).toMatchObject({
      name: `Ad ${STILL_EXT}`,
      result: 'refused',
    });
    expect(refused?.reason).toMatch(/existing Facebook or Instagram post/);
    expect(carriesOurLinkTags(provider.linkTagsOf(REEL_EXT))).toBe(true);
    // One ad without the tags keeps the whole campaign Not Tracked.
    expect(outcome.tracked).toBe(false);
    expect(await isTracked(campaign.id)).toBe(false);
  });

  it('rewrites nothing on a second press, so a repeat is harmless', async () => {
    await connect();
    const campaign = await discovered();
    await startTracking(campaign.id);
    const writes = provider.tagWrites.length;

    const again = await startTracking(campaign.id);

    expect(provider.tagWrites).toHaveLength(writes);
    expect(again.tracked).toBe(true);
    expect(again.ads.map((ad) => ad.result)).toEqual([
      'already_tagged',
      'already_tagged',
    ]);
  });

  it('does not rebuild an ad that was tagged at the platform since it was last read', async () => {
    await connect();
    const campaign = await discovered();
    // The merchant tagged one by hand in Ads Manager after the sync read it.
    provider.setLinkTags(REEL_EXT, buildLinkTags());

    const outcome = await startTracking(campaign.id);

    expect(provider.tagWrites.map((w) => w.externalAdId)).toEqual([STILL_EXT]);
    expect(resultFor(outcome, REEL_EXT)?.result).toBe('already_tagged');
    expect(outcome.tracked).toBe(true);
  });

  it('leaves the campaign Not Tracked and says so when the platform fails', async () => {
    await connect();
    const campaign = await discovered();
    provider.failTagWritesAfter = 0;

    const outcome = await startTracking(campaign.id);

    expect(outcome.tracked).toBe(false);
    expect(outcome.message).toMatch(/could not be reached/);
    expect(outcome.message).not.toMatch(/your (ad )?account/i);
    expect(outcome.ads.map((ad) => ad.result)).toEqual([
      'not_attempted',
      'not_attempted',
    ]);
    expect(await isTracked(campaign.id)).toBe(false);
  });

  it('keeps what was tagged before a failure, and a second press finishes the rest', async () => {
    await connect();
    const campaign = await discovered();
    provider.failTagWritesAfter = 1;

    const partial = await startTracking(campaign.id);
    expect(partial.tracked).toBe(false);
    expect(partial.message).not.toBeNull();
    const [first] = provider.tagWrites;
    expect(resultFor(partial, first.externalAdId)?.result).toBe('tagged');

    provider.failTagWritesAfter = null;
    const finished = await startTracking(campaign.id);

    expect(provider.tagWrites.map((w) => w.externalAdId).sort()).toEqual(
      [REEL_EXT, STILL_EXT].sort(),
    );
    expect(resultFor(finished, first.externalAdId)?.result).toBe(
      'already_tagged',
    );
    expect(finished.tracked).toBe(true);
  });

  it('stays Tracked through the syncs that follow', async () => {
    await connect();
    const campaign = await discovered();
    await startTracking(campaign.id);

    await admin.client.post('/ad-platforms/meta/sync').expect(201);

    expect(await isTracked(campaign.id)).toBe(true);
  });

  it('credits clicks after tagging to the campaign and the right ad, and never backfills', async () => {
    await connect();
    const campaign = await discovered();

    // A click on the untagged ad: the landing URL carried nothing of ours.
    await placeOrder({
      utmSource: 'facebook',
      occurredAt: new Date().toISOString(),
    });

    await startTracking(campaign.id);

    // A click after tagging: Meta expanded the macros with its own ids.
    await placeOrder({
      utmSource: 'meta',
      utmMedium: 'paid',
      utmCampaign: CAMPAIGN_EXT,
      utmContent: STILL_EXT,
      occurredAt: new Date().toISOString(),
    });

    const perf = await admin.client
      .get(`/marketing/campaigns/${campaign.id}/performance?period=30d`)
      .expect(200);
    const line = (perf.body as CampaignPerformanceReport).campaign;
    expect(line).toMatchObject({
      hasLinkTags: true,
      orders: 1,
      revenue: ORDER_TOTAL,
      unassigned: { orders: 0, revenue: 0 },
    });
    expect(
      line.ads.find((ad) => ad.adId === campaign.ads[STILL_EXT]),
    ).toMatchObject({ orders: 1, revenue: ORDER_TOTAL });
    expect(
      line.ads.find((ad) => ad.adId === campaign.ads[REEL_EXT]),
    ).toMatchObject({ orders: 0, revenue: 0 });

    // The order from before stays unmeasurable rather than being guessed onto it.
    const report = await admin.client
      .get('/marketing/attributed-revenue?period=30d')
      .expect(200);
    expect((report.body as AttributedRevenueReport).unattributed).toEqual({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
  });

  it('requires campaigns.write', async () => {
    await connect();
    const campaign = await discovered();

    const agent = await createAdminUser(
      app,
      fixture.organizationId,
      fixture.storeId,
      'support_agent',
    );
    extraUsers.push(agent.id);
    await agent.client.post(`/campaigns/${campaign.id}/tracking`).expect(403);
    expect(provider.tagWrites).toHaveLength(0);

    const manager = await createAdminUser(
      app,
      fixture.organizationId,
      fixture.storeId,
      'product_manager',
    );
    extraUsers.push(manager.id);
    expect((await startTracking(campaign.id, manager)).tracked).toBe(true);
  });

  it('refuses while Meta is disconnected, and writes nothing', async () => {
    await connect();
    const campaign = await discovered();
    await admin.client.post('/ad-platforms/meta/disconnect').expect(201);

    const res = await admin.client
      .post(`/campaigns/${campaign.id}/tracking`)
      .expect(409);
    expect((res.body as { message: string }).message).toMatch(/Reconnect Meta/);
    expect(provider.tagWrites).toHaveLength(0);
  });

  it('cannot reach another organization’s campaign', async () => {
    await connect();
    const campaign = await discovered();

    const other = await seedStorefront(app);
    const outsider = await createAdminUser(
      app,
      other.organizationId,
      other.storeId,
    );
    try {
      await outsider.client
        .post(`/campaigns/${campaign.id}/tracking`)
        .expect(404);
      expect(provider.tagWrites).toHaveLength(0);
    } finally {
      await destroyStorefront(app, other.organizationId);
      await destroyAdminUsers(app, [outsider.id]);
    }
  });
});
