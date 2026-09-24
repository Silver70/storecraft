/**
 * Editing a running campaign, end to end: the admin's request, one change at
 * the platform, and the row here as soon as the platform accepted it.
 *
 * The ad platform is the in-memory fake. It records every change it accepted,
 * applies it to the ad account it reports, so the sync that follows some edits
 * reads it back, and can refuse a change the way Meta does. Everything else is
 * production wiring.
 *
 * What is asserted is what the ticket exists for. Each change spends, or stops
 * spending, real money, so it reaches the platform, touches nothing beside it,
 * and is reflected here straight away. A refused change leaves everything here
 * as it was and says what the platform said. What is deliberately not editable
 * cannot be sent at all.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  ads,
  campaigns,
  productMedia,
  stores,
  type Campaign,
} from '../src/shared/database/schema';
import type {
  AdTree,
  DraftComplaint,
  PlatformSignals,
  ReportedAd,
} from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import type { CreateCampaignOutcome } from '../src/modules/ad-platform/services/campaign-creation.service';
import type { AddAdOutcome } from '../src/modules/ad-platform/services/campaign-edit.service';
import type { CampaignPerformanceReport } from '../src/modules/marketing/services/attributed-revenue.service';
import { buildLinkTags } from '../src/modules/ad-platform/utils/link-tags.util';
import { dayInTimezone } from '../src/modules/ad-platform/utils/sync-window.util';
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
const STOREFRONT = 'https://shop.example.test';

interface Rejection {
  message: string;
  complaints: DraftComplaint[];
}

const DELIVERING: PlatformSignals = {
  delivery: 'active',
  review: 'approved',
  startsAt: null,
  endsAt: null,
};

/** An ad built in Ads Manager, in its own ad set. */
const builtElsewhere = (externalAdId: string, adSet: string): ReportedAd => ({
  externalAdId,
  name: `Ad ${externalAdId}`,
  format: 'image',
  creativeUrl: null,
  externalAdSetId: adSet,
  signals: DELIVERING,
  days: [],
});

describe('Edit a campaign (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;
  let productImageId: string;
  let productImageUrl: string;
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
    await db
      .update(stores)
      .set({ storefrontUrl: STOREFRONT })
      .where(eq(stores.id, fixture.storeId));
    productImageUrl = `https://cdn.test.invalid/products/${fixture.productId}/coat.jpg`;
    const [media] = await db
      .insert(productMedia)
      .values({
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        productId: fixture.productId,
        url: productImageUrl,
        mediaType: 'image',
        isPrimary: true,
      })
      .returning({ id: productMedia.id });
    productImageId = media.id;
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
    await destroyAdminUsers(app, [admin.id, ...extraUsers.splice(0)]);
  });

  // ─── Driving the flow the way a merchant does ───────────────────────────────

  async function connect(): Promise<void> {
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

  const today = () => dayInTimezone(new Date(), 'UTC');

  function adForm(overrides: Record<string, unknown> = {}) {
    return {
      mediaSource: 'product',
      productMediaId: productImageId,
      primaryText: 'Warm coats, cold prices.',
      headline: 'Coats from $49',
      destination: 'product',
      destinationProductId: fixture.productId,
      ...overrides,
    };
  }

  /** A campaign created here with two ads, live, and connected to Meta. */
  async function running(): Promise<CreateCampaignOutcome> {
    await connect();
    const res = await admin.client
      .post('/campaigns', {
        name: 'Autumn coats',
        dailyBudget: 2500,
        startDate: today(),
        endDate: null,
        countries: ['US'],
        ageMin: 25,
        ageMax: 54,
        launch: 'active',
        ads: [adForm(), adForm({ destination: 'all_products' })],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return res.body as CreateCampaignOutcome;
  }

  async function stored(campaignId: string): Promise<Campaign> {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    return row;
  }

  async function storedAds(campaignId: string) {
    return db
      .select()
      .from(ads)
      .where(eq(ads.campaignId, campaignId))
      .orderBy(ads.name);
  }

  function addAd(
    campaignId: string,
    body: Record<string, unknown>,
    key: string = randomUUID(),
    as: AdminUserFixture = admin,
  ) {
    return as.client
      .post(`/campaigns/${campaignId}/ads`, body)
      .set('Idempotency-Key', key);
  }

  async function placeOrder(lastTouch: Record<string, string>): Promise<void> {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, { attribution: { lastTouch } });
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

  // ─── Rename, budget, end date ───────────────────────────────────────────────

  it('renames a campaign at the platform and here, and its reporting is unaffected', async () => {
    const { campaignId, externalId } = await running();
    const [firstAd] = provider.creates[0].created.ads;
    await placeOrder({
      utmSource: 'meta',
      utmMedium: 'paid',
      utmCampaign: externalId,
      utmContent: firstAd.externalAdId,
      occurredAt: new Date().toISOString(),
    });

    const res = await admin.client
      .patch(`/campaigns/${campaignId}`, { name: 'Winter coats' })
      .expect(200);

    expect(provider.changes).toEqual([
      {
        kind: 'campaign',
        externalCampaignId: externalId,
        name: 'Winter coats',
      },
    ]);
    expect((res.body as Campaign).name).toBe('Winter coats');
    expect((await stored(campaignId)).name).toBe('Winter coats');

    // The join is on the platform's ids, so the order still lands.
    const perf = await admin.client
      .get(`/marketing/campaigns/${campaignId}/performance?period=30d`)
      .expect(200);
    expect((perf.body as CampaignPerformanceReport).campaign).toMatchObject({
      name: 'Winter coats',
      orders: 1,
      revenue: ORDER_TOTAL,
    });
  });

  it('changes the daily budget in the store’s currency, stored at once in minor units', async () => {
    const { campaignId, externalId } = await running();
    expect(await stored(campaignId)).toMatchObject({
      budgetLevel: 'campaign',
      dailyBudget: 2500,
    });

    await admin.client
      .patch(`/campaigns/${campaignId}`, { dailyBudget: 4250 })
      .expect(200);

    expect(provider.changes).toEqual([
      { kind: 'campaign', externalCampaignId: externalId, dailyBudget: 4250 },
    ]);
    expect((await stored(campaignId)).dailyBudget).toBe(4250);

    // A later sync reads the same budget back from the platform.
    await admin.client.post('/ad-platforms/meta/sync').expect(201);
    expect((await stored(campaignId)).dailyBudget).toBe(4250);
  });

  it('sets the end date on the ad set, and clears it again', async () => {
    const { campaignId } = await running();
    const adSet = provider.creates[0].created.ads[0].externalAdSetId;

    const endDay = '2099-10-31';
    await admin.client
      .patch(`/campaigns/${campaignId}`, { endDate: endDay })
      .expect(200);

    // The whole of the end day is spent: it stops at the midnight after.
    const endsAt = new Date('2099-11-01T00:00:00.000Z');
    expect(provider.changes).toEqual([
      { kind: 'ad_set_end', externalAdSetId: adSet, endsAt },
    ]);
    expect((await stored(campaignId)).endsAt).toEqual(endsAt);

    await admin.client
      .patch(`/campaigns/${campaignId}`, { endDate: null })
      .expect(200);
    expect(provider.changes.at(-1)).toEqual({
      kind: 'ad_set_end',
      externalAdSetId: adSet,
      endsAt: null,
    });
    expect((await stored(campaignId)).endsAt).toBeNull();
  });

  it('refuses an end date already over, and sends nothing', async () => {
    const { campaignId } = await running();

    const res = await admin.client
      .patch(`/campaigns/${campaignId}`, { endDate: '2020-01-01' })
      .expect(422);

    expect((res.body as Rejection).complaints).toEqual([
      expect.objectContaining({ field: 'schedule', adIndex: null }),
    ]);
    expect(provider.changes).toHaveLength(0);
    expect((await stored(campaignId)).endsAt).toBeNull();
  });

  it('disables the budget of a campaign whose budget lives per ad set', async () => {
    await connect();
    const tree: AdTree = {
      currency: 'USD',
      complete: true,
      campaigns: [
        {
          externalCampaignId: '120200000000000900',
          name: 'Built in Ads Manager',
          signals: DELIVERING,
          budget: { level: 'ad_set', daily: null },
          ads: [builtElsewhere('120210000000000901', '120220000000000901')],
        },
      ],
    };
    provider.setAdTree('act_100', tree);
    await admin.client.post('/ad-platforms/meta/sync').expect(201);
    const [discovered] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.storeId, fixture.storeId));
    expect(discovered).toMatchObject({
      budgetLevel: 'ad_set',
      dailyBudget: null,
    });

    const res = await admin.client
      .patch(`/campaigns/${discovered.id}`, { dailyBudget: 5000 })
      .expect(422);

    const [complaint] = (res.body as Rejection).complaints;
    expect(complaint).toMatchObject({ adIndex: null, field: 'dailyBudget' });
    expect(complaint.message).toMatch(/each of its ad sets.*Ads Manager/);
    expect(provider.changes).toHaveLength(0);
  });

  // ─── Pause and resume ───────────────────────────────────────────────────────

  it('pauses and resumes the whole campaign', async () => {
    const { campaignId, externalId } = await running();

    const paused = await admin.client
      .put(`/campaigns/${campaignId}/status`, { status: 'paused' })
      .expect(200);
    expect((paused.body as Campaign).status).toBe('paused');
    expect((await stored(campaignId)).status).toBe('paused');

    const resumed = await admin.client
      .put(`/campaigns/${campaignId}/status`, { status: 'active' })
      .expect(200);
    // Resumed, and read back from the platform: its ads are in review still.
    expect((resumed.body as Campaign).status).not.toBe('paused');

    expect(provider.changes).toEqual([
      {
        kind: 'campaign_delivery',
        externalCampaignId: externalId,
        status: 'paused',
      },
      {
        kind: 'campaign_delivery',
        externalCampaignId: externalId,
        status: 'active',
      },
    ]);
  });

  it('pauses and resumes one ad without touching its siblings', async () => {
    const { campaignId } = await running();
    const [first, second] = await storedAds(campaignId);
    const siblingBefore = second.status;

    await admin.client
      .put(`/campaigns/${campaignId}/ads/${first.id}/status`, {
        status: 'paused',
      })
      .expect(200);

    expect(provider.changes).toEqual([
      { kind: 'ad_delivery', externalAdId: first.externalId, status: 'paused' },
    ]);
    const [afterFirst, afterSecond] = await storedAds(campaignId);
    expect(afterFirst.status).toBe('paused');
    expect(afterSecond.status).toBe(siblingBefore);

    await admin.client
      .put(`/campaigns/${campaignId}/ads/${first.id}/status`, {
        status: 'active',
      })
      .expect(200);
    expect(provider.changes.at(-1)).toEqual({
      kind: 'ad_delivery',
      externalAdId: first.externalId,
      status: 'active',
    });
    expect((await storedAds(campaignId))[0].status).not.toBe('paused');
  });

  it('will not switch an ad of another campaign through this one', async () => {
    const { campaignId } = await running();
    await admin.client
      .put(`/campaigns/${campaignId}/ads/${randomUUID()}/status`, {
        status: 'paused',
      })
      .expect(404);
    expect(provider.changes).toHaveLength(0);
  });

  // ─── Adding an ad ───────────────────────────────────────────────────────────

  it('adds an ad to the running campaign, created carrying its link tags', async () => {
    const { campaignId } = await running();
    const adSet = provider.creates[0].created.ads[0].externalAdSetId;

    const res = await addAd(
      campaignId,
      adForm({ headline: 'New in', destination: 'home' }),
    ).expect(201);
    const outcome = res.body as AddAdOutcome;

    expect(provider.adds).toHaveLength(1);
    const [sent] = provider.adds;
    expect(sent.urlTags).toBe(buildLinkTags());
    expect(sent.externalAdSetId).toBe(adSet);
    expect(sent.input.pixelId).toBe(provider.pixels[0].pixelId);
    expect(sent.input.ad).toEqual({
      name: 'Autumn coats · Ad 3',
      media: { kind: 'image', url: productImageUrl },
      primaryText: 'Warm coats, cold prices.',
      headline: 'New in',
      callToAction: 'shop_now',
      destinationUrl: `${STOREFRONT}/`,
    });

    // Stored straight away, tagged, and the campaign still Tracked.
    expect(outcome).toMatchObject({
      externalId: sent.created.externalAdId,
      tracked: true,
    });
    const [added] = await db.select().from(ads).where(eq(ads.id, outcome.adId));
    expect(added).toMatchObject({
      campaignId,
      externalId: sent.created.externalAdId,
      hasLinkTags: true,
      creativeUrl: productImageUrl,
      adSetExternalId: adSet,
    });
    expect(added.linkTagsCheckedAt).not.toBeNull();
    expect(await storedAds(campaignId)).toHaveLength(3);
  });

  it('adds one ad however many times the same press is retried', async () => {
    const { campaignId } = await running();
    const key = randomUUID();

    const first = (await addAd(campaignId, adForm(), key).expect(201))
      .body as AddAdOutcome;
    const again = (await addAd(campaignId, adForm(), key).expect(201))
      .body as AddAdOutcome;

    expect(again.adId).toBe(first.adId);
    expect(provider.adds).toHaveLength(1);
    expect(await storedAds(campaignId)).toHaveLength(3);
  });

  it('says what Meta objected to in an added ad, and adds nothing', async () => {
    const { campaignId } = await running();
    provider.addRejection = [
      { adIndex: 0, field: 'media', message: 'Use a larger image.' },
    ];

    const res = await addAd(campaignId, adForm()).expect(422);

    expect((res.body as Rejection).complaints).toEqual([
      { adIndex: 0, field: 'media', message: 'Use a larger image.' },
    ]);
    expect(await storedAds(campaignId)).toHaveLength(2);
  });

  it('checks an added ad by the create form’s rules before anything is sent', async () => {
    const { campaignId } = await running();

    const res = await addAd(
      campaignId,
      adForm({
        destination: 'custom',
        destinationPath: 'https://elsewhere.test/',
      }),
    ).expect(422);

    expect((res.body as Rejection).complaints[0]).toMatchObject({
      adIndex: 0,
      field: 'destination',
    });
    expect(provider.adds).toHaveLength(0);
  });

  // ─── The cover ──────────────────────────────────────────────────────────────

  it('chooses the cover from the campaign’s own ads or an upload, and keeps it through a sync', async () => {
    const { campaignId } = await running();
    const [first] = await storedAds(campaignId);
    await db
      .update(ads)
      .set({ creativeUrl: 'https://cdn.test.invalid/own/second.jpg' })
      .where(eq(ads.id, first.id));

    await admin.client
      .put(`/campaigns/${campaignId}/cover`, { adId: first.id })
      .expect(200);
    expect((await stored(campaignId)).coverUrl).toBe(
      'https://cdn.test.invalid/own/second.jpg',
    );

    const upload = await admin.client
      .attach('/campaigns/creatives', 'file', Buffer.from('png'), {
        filename: 'cover.png',
        contentType: 'image/png',
      })
      .expect(201);
    const { url } = upload.body as { url: string };
    await admin.client
      .put(`/campaigns/${campaignId}/cover`, { uploadUrl: url })
      .expect(200);
    expect((await stored(campaignId)).coverUrl).toBe(url);

    // The cover is ours, not the platform's, and a sync never overwrites it.
    await admin.client.post('/ad-platforms/meta/sync').expect(201);
    expect((await stored(campaignId)).coverUrl).toBe(url);
    expect(provider.changes).toHaveLength(0);
  });

  it('refuses a cover that is not one of this store’s pictures', async () => {
    const { campaignId } = await running();
    const before = (await stored(campaignId)).coverUrl;

    await admin.client
      .put(`/campaigns/${campaignId}/cover`, {
        uploadUrl: 'https://elsewhere.test/cover.jpg',
      })
      .expect(422);
    expect((await stored(campaignId)).coverUrl).toBe(before);
  });

  // ─── Refusals, outages, and what is not on offer ────────────────────────────

  it('leaves everything as it was when the platform refuses, and says what it said', async () => {
    const { campaignId } = await running();
    provider.rejectNextChange = 'The minimum daily budget is $1.00.';

    const res = await admin.client
      .patch(`/campaigns/${campaignId}`, { dailyBudget: 50 })
      .expect(422);

    const body = res.body as Rejection;
    expect(body.message).toMatch(/Nothing has changed/);
    expect(body.complaints).toEqual([
      {
        adIndex: null,
        field: 'dailyBudget',
        message: 'The minimum daily budget is $1.00.',
      },
    ]);
    expect((await stored(campaignId)).dailyBudget).toBe(2500);
    expect(provider.changes).toHaveLength(0);
  });

  it('leaves everything as it was when the platform cannot be reached', async () => {
    const { campaignId } = await running();
    const before = await stored(campaignId);
    provider.failAlways = new Error('vendor down');

    await admin.client
      .put(`/campaigns/${campaignId}/status`, { status: 'paused' })
      .expect(503);
    await admin.client
      .patch(`/campaigns/${campaignId}`, { name: 'Never' })
      .expect(503);

    const after = await stored(campaignId);
    expect(after.status).toBe(before.status);
    expect(after.name).toBe('Autumn coats');
  });

  it('offers no way to change the audience, the goal or an ad’s creative, or to delete', async () => {
    const { campaignId } = await running();
    const [first] = await storedAds(campaignId);

    for (const body of [
      { countries: ['FR'] },
      { ageMin: 30 },
      { goal: 'traffic' },
      { ads: [adForm()] },
    ]) {
      await admin.client.patch(`/campaigns/${campaignId}`, body).expect(400);
    }
    await admin.client
      .patch(`/campaigns/${campaignId}/ads/${first.id}`, { headline: 'x' })
      .expect(404);
    await admin.client.delete(`/campaigns/${campaignId}`).expect(404);
    await admin.client
      .delete(`/campaigns/${campaignId}/ads/${first.id}`)
      .expect(404);

    expect(provider.changes).toHaveLength(0);
  });

  it('requires campaigns.write for every edit', async () => {
    const { campaignId } = await running();
    const [first] = await storedAds(campaignId);
    const agent = await createAdminUser(
      app,
      fixture.organizationId,
      fixture.storeId,
      'support_agent',
    );
    extraUsers.push(agent.id);

    await agent.client
      .patch(`/campaigns/${campaignId}`, { name: 'x' })
      .expect(403);
    await agent.client
      .put(`/campaigns/${campaignId}/status`, { status: 'paused' })
      .expect(403);
    await agent.client
      .put(`/campaigns/${campaignId}/ads/${first.id}/status`, {
        status: 'paused',
      })
      .expect(403);
    await addAd(campaignId, adForm(), randomUUID(), agent).expect(403);
    await agent.client
      .put(`/campaigns/${campaignId}/cover`, { adId: first.id })
      .expect(403);
    expect(provider.changes).toHaveLength(0);
    expect(provider.adds).toHaveLength(0);

    const manager = await createAdminUser(
      app,
      fixture.organizationId,
      fixture.storeId,
      'product_manager',
    );
    extraUsers.push(manager.id);
    await manager.client
      .patch(`/campaigns/${campaignId}`, { name: 'By a manager' })
      .expect(200);
  });

  it('cannot change another organization’s campaign', async () => {
    const { campaignId } = await running();
    const other = await seedStorefront(app);
    const intruder = await createAdminUser(
      app,
      other.organizationId,
      other.storeId,
    );
    try {
      await intruder.client
        .patch(`/campaigns/${campaignId}`, { name: 'Mine now' })
        .expect(404);
      await intruder.client
        .put(`/campaigns/${campaignId}/status`, { status: 'paused' })
        .expect(404);
      expect(provider.changes).toHaveLength(0);
      expect((await stored(campaignId)).name).toBe('Autumn coats');
    } finally {
      await destroyStorefront(app, other.organizationId);
      await destroyAdminUsers(app, [intruder.id]);
    }
  });

  it('is impossible once Meta is disconnected', async () => {
    const { campaignId } = await running();
    await admin.client.post('/ad-platforms/meta/disconnect').expect(201);

    await admin.client
      .patch(`/campaigns/${campaignId}`, { name: 'Frozen' })
      .expect(409);
    await admin.client
      .put(`/campaigns/${campaignId}/status`, { status: 'paused' })
      .expect(409);
    await addAd(campaignId, adForm()).expect(409);
    expect(provider.changes).toHaveLength(0);
    expect(provider.adds).toHaveLength(0);
  });
});
