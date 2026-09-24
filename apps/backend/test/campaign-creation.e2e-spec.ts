/**
 * Creating a campaign, end to end: the admin form's request, through the rules
 * here and the platform's dry run, to one create at the platform. Then the rows
 * stored straight away, the grid, the sync that follows, and an Order whose
 * click names the new ids.
 *
 * The ad platform is the in-memory fake. It records every create with the
 * tags each ad went out carrying, and adds the campaign to the ad account so a
 * later sync reads it back. Everything else is production wiring.
 *
 * What is asserted is what the ticket exists for. A created campaign is
 * measurable from birth: the tags are in the call that creates the ads. It is
 * never created twice. It is never half-created here.
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
  products,
  stores,
} from '../src/shared/database/schema';
import type { DraftComplaint } from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import type { CreateCampaignOutcome } from '../src/modules/ad-platform/services/campaign-creation.service';
import type {
  AttributedRevenueReport,
  CampaignPerformanceReport,
} from '../src/modules/marketing/services/attributed-revenue.service';
import { buildLinkTags } from '../src/modules/ad-platform/utils/link-tags.util';
import { dayInTimezone } from '../src/modules/ad-platform/utils/sync-window.util';
import { createTestApp } from './helpers/test-app';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
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

describe('Create a campaign (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let storage: FakeStorageService;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;
  let productSlug: string;
  let productImageId: string;
  let productImageUrl: string;
  const extraUsers: string[] = [];

  beforeAll(async () => {
    ({ app, adPlatform: provider, storage } = await createTestApp());
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
    const [product] = await db
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.id, fixture.productId));
    productSlug = product.slug;
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

  /** The form as a merchant fills it in: two ads, one of each destination kind. */
  function form(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Autumn coats',
      dailyBudget: 2500,
      startDate: today(),
      endDate: null,
      countries: ['us', 'CA'],
      ageMin: 25,
      ageMax: 54,
      launch: 'active',
      ads: [
        {
          mediaSource: 'product',
          productMediaId: productImageId,
          primaryText: 'Warm coats, cold prices.',
          headline: 'Coats from $49',
          destination: 'product',
          destinationProductId: fixture.productId,
        },
        {
          mediaSource: 'product',
          productMediaId: productImageId,
          primaryText: 'Everything for the cold.',
          headline: 'The whole autumn range',
          callToAction: 'learn_more',
          destination: 'all_products',
        },
      ],
      ...overrides,
    };
  }

  function create(
    body: Record<string, unknown>,
    key: string = randomUUID(),
    as: AdminUserFixture = admin,
  ) {
    return as.client.post('/campaigns', body).set('Idempotency-Key', key);
  }

  async function storedCampaigns() {
    return db
      .select()
      .from(campaigns)
      .where(eq(campaigns.storeId, fixture.storeId));
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

  // ─── The cases ──────────────────────────────────────────────────────────────

  it('creates every ad carrying the link tags, in the one call that creates it', async () => {
    await connect();

    const res = await create(form()).expect(201);
    const outcome = res.body as CreateCampaignOutcome;

    expect(provider.creates).toHaveLength(1);
    const [sent] = provider.creates;
    expect(sent.urlTags).toBe(buildLinkTags());
    expect(sent.externalAccountId).toBe('act_100');
    expect(sent.draft).toMatchObject({
      name: 'Autumn coats',
      dailyBudget: 2500,
      currency: 'USD',
      startsAt: null,
      endsAt: null,
      countries: ['US', 'CA'],
      ageMin: 25,
      ageMax: 54,
      launch: 'active',
    });
    // The Pixel the connection found is the one it optimises for.
    expect(sent.draft.pixelId).toBe(provider.pixels[0].pixelId);
    expect(sent.draft.ads).toEqual([
      {
        name: 'Autumn coats · Ad 1',
        media: { kind: 'image', url: productImageUrl },
        primaryText: 'Warm coats, cold prices.',
        headline: 'Coats from $49',
        callToAction: 'shop_now',
        destinationUrl: `${STOREFRONT}/products/${productSlug}`,
      },
      {
        name: 'Autumn coats · Ad 2',
        media: { kind: 'image', url: productImageUrl },
        primaryText: 'Everything for the cold.',
        headline: 'The whole autumn range',
        callToAction: 'learn_more',
        destinationUrl: `${STOREFRONT}/products`,
      },
    ]);
    // Checked by the platform's dry run first, with the same draft.
    expect(provider.validations).toHaveLength(1);
    expect(provider.validations[0].draft).toEqual(sent.draft);

    expect(outcome).toMatchObject({
      externalId: sent.created.externalCampaignId,
      tracked: true,
      replayed: false,
    });
  });

  it('stores the campaign, its ads and their platform ids straight away, Tracked, with the first ad as its cover', async () => {
    await connect();
    const fetchesBefore = provider.fetched.length;

    const outcome = (await create(form()).expect(201))
      .body as CreateCampaignOutcome;

    // No sync ran to put it there.
    expect(provider.fetched).toHaveLength(fetchesBefore);
    const [created] = provider.creates.map((c) => c.created);
    const [campaign] = await storedCampaigns();
    expect(campaign).toMatchObject({
      id: outcome.campaignId,
      externalId: created.externalCampaignId,
      name: 'Autumn coats',
      status: 'in_review',
      hasLinkTags: true,
      coverUrl: productImageUrl,
    });
    const stored = await db
      .select()
      .from(ads)
      .where(eq(ads.campaignId, campaign.id));
    expect(stored.map((ad) => ad.externalId).sort()).toEqual(
      created.ads.map((ad) => ad.externalAdId).sort(),
    );
    for (const ad of stored) {
      expect(ad).toMatchObject({
        hasLinkTags: true,
        format: 'image',
        creativeUrl: productImageUrl,
      });
      // Confirmed by reading the tags back, not taken on trust.
      expect(ad.linkTagsCheckedAt).not.toBeNull();
    }

    const grid = await admin.client
      .get('/marketing/attributed-revenue?period=30d')
      .expect(200);
    const line = (grid.body as AttributedRevenueReport).campaigns.find(
      (c) => c.campaignId === outcome.campaignId,
    );
    expect(line).toMatchObject({
      hasLinkTags: true,
      coverUrl: productImageUrl,
      status: 'in_review',
    });
  });

  it('saves a campaign paused when asked, and it reads Paused', async () => {
    await connect();

    await create(form({ launch: 'paused' })).expect(201);

    expect(provider.creates[0].draft.launch).toBe('paused');
    const [campaign] = await storedCampaigns();
    expect(campaign.status).toBe('paused');
  });

  it('credits an Order whose click carries the new ids to the campaign and the ad', async () => {
    await connect();
    const outcome = (await create(form()).expect(201))
      .body as CreateCampaignOutcome;
    const [created] = provider.creates.map((c) => c.created);
    const second = created.ads[1].externalAdId;

    // Meta expanded the macros with its own ids at the click.
    await placeOrder({
      utmSource: 'meta',
      utmMedium: 'paid',
      utmCampaign: created.externalCampaignId,
      utmContent: second,
      occurredAt: new Date().toISOString(),
    });

    const perf = await admin.client
      .get(`/marketing/campaigns/${outcome.campaignId}/performance?period=30d`)
      .expect(200);
    const line = (perf.body as CampaignPerformanceReport).campaign;
    expect(line).toMatchObject({
      hasLinkTags: true,
      orders: 1,
      revenue: ORDER_TOTAL,
      unassigned: { orders: 0, revenue: 0 },
    });
    const [adRow] = await db
      .select({ id: ads.id })
      .from(ads)
      .where(eq(ads.externalId, second));
    expect(line.ads.find((ad) => ad.adId === adRow.id)).toMatchObject({
      orders: 1,
      revenue: ORDER_TOTAL,
    });
  });

  it('stays Tracked, and in place, through the sync that follows', async () => {
    await connect();
    const outcome = (await create(form()).expect(201))
      .body as CreateCampaignOutcome;
    const readsBefore = provider.tagReads.length;

    await admin.client.post('/ad-platforms/meta/sync').expect(201);

    const rows = await storedCampaigns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: outcome.campaignId,
      hasLinkTags: true,
    });
    // Already confirmed at create, so the sync spends no reads on them.
    expect(provider.tagReads).toHaveLength(readsBefore);
  });

  it('puts the platform’s dry-run complaints on the form, and creates nothing', async () => {
    await connect();
    provider.draftComplaints = [
      {
        adIndex: null,
        field: 'dailyBudget',
        message: 'Your budget must be at least $1.00 a day.',
      },
      { adIndex: 1, field: 'media', message: 'The image is too small.' },
    ];

    const res = await create(form()).expect(422);

    expect((res.body as Rejection).complaints).toEqual(
      provider.draftComplaints,
    );
    expect(provider.creates).toHaveLength(0);
    expect(await storedCampaigns()).toHaveLength(0);
  });

  it('refuses what breaks the rules here before asking the platform anything', async () => {
    await connect();
    await db
      .update(products)
      .set({ status: 'draft' })
      .where(eq(products.id, fixture.productId));

    const res = await create(
      form({
        startDate: '2020-01-01',
        countries: ['USA'],
        ageMin: 50,
        ageMax: 30,
      }),
    ).expect(422);

    const complaints = (res.body as Rejection).complaints;
    expect(complaints.map((c) => [c.adIndex, c.field])).toEqual(
      expect.arrayContaining([
        [null, 'schedule'],
        [null, 'audience'],
        [0, 'destination'],
      ]),
    );
    expect(provider.validations).toHaveLength(0);
    expect(provider.creates).toHaveLength(0);
  });

  it('refuses a destination off the storefront, and says the storefront URL is missing', async () => {
    await connect();
    const offsite = form({
      ads: [
        {
          ...form().ads[0],
          destination: 'custom',
          destinationPath: 'https://elsewhere.example/sale',
        },
      ],
    });
    const off = await create(offsite).expect(422);
    expect((off.body as Rejection).complaints[0]).toMatchObject({
      adIndex: 0,
      field: 'destination',
    });

    await db
      .update(stores)
      .set({ storefrontUrl: null })
      .where(eq(stores.id, fixture.storeId));
    const unset = await create(form()).expect(422);
    expect((unset.body as Rejection).complaints[0]).toMatchObject({
      field: 'destination',
    });
    expect(provider.creates).toHaveLength(0);
  });

  it('leaves nothing here when the platform refuses the create, and says why', async () => {
    await connect();
    provider.createRejection = [
      {
        adIndex: 0,
        field: 'media',
        message: 'Meta could not process this video.',
      },
    ];

    const res = await create(form()).expect(422);

    expect((res.body as Rejection).message).toMatch(/Nothing was created/);
    expect((res.body as Rejection).complaints).toEqual(
      provider.createRejection,
    );
    expect(await storedCampaigns()).toHaveLength(0);
  });

  it('answers a retried create with the campaign already made, never a second one', async () => {
    await connect();
    const key = randomUUID();

    const first = (await create(form(), key).expect(201))
      .body as CreateCampaignOutcome;
    const again = (await create(form(), key).expect(201))
      .body as CreateCampaignOutcome;

    expect(provider.creates).toHaveLength(1);
    expect(again).toMatchObject({
      campaignId: first.campaignId,
      replayed: true,
    });
    expect(await storedCampaigns()).toHaveLength(1);
  });

  it('recovers a create whose answer was lost without building a second campaign', async () => {
    await connect();
    const key = randomUUID();
    provider.failAfterCreating = true;

    const lost = await create(form(), key).expect(503);
    expect((lost.body as { message: string }).message).toMatch(
      /cannot create a second campaign/,
    );
    expect(await storedCampaigns()).toHaveLength(0);

    await create(form(), key).expect(201);

    expect(provider.creates).toHaveLength(1);
    const rows = await storedCampaigns();
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe(
      provider.creates[0].created.externalCampaignId,
    );
  });

  it('says so when the same create is already in flight', async () => {
    await connect();
    provider.createInFlight = true;

    await create(form()).expect(409);
    expect(await storedCampaigns()).toHaveLength(0);
  });

  it('requires an Idempotency-Key', async () => {
    await connect();
    await admin.client.post('/campaigns', form()).expect(400);
    expect(provider.creates).toHaveLength(0);
  });

  it('makes an ad from an upload to this store’s own storage, and refuses anyone else’s', async () => {
    await connect();
    const upload = await admin.client
      .attach('/campaigns/creatives', 'file', Buffer.from('jpeg'), {
        filename: 'coat.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const { url, kind } = upload.body as { url: string; kind: string };
    expect(kind).toBe('image');
    expect(storage.stored.at(-1)?.key).toContain(
      `ad-creatives/${fixture.organizationId}/${fixture.storeId}/uploads/`,
    );

    const uploaded = form({
      ads: [
        {
          ...form().ads[0],
          mediaSource: 'upload',
          uploadUrl: url,
          productMediaId: undefined,
        },
      ],
    });
    await create(uploaded).expect(201);
    expect(provider.creates[0].draft.ads[0].media).toEqual({
      kind: 'image',
      url,
    });

    const foreign = form({
      ads: [
        {
          ...form().ads[0],
          mediaSource: 'upload',
          uploadUrl:
            'https://cdn.test.invalid/ad-creatives/other-org/other-store/uploads/x.jpg',
          productMediaId: undefined,
        },
      ],
    });
    const res = await create(foreign).expect(422);
    expect((res.body as Rejection).complaints[0]).toMatchObject({
      adIndex: 0,
      field: 'media',
    });
    expect(provider.creates).toHaveLength(1);
  });

  it('refuses an upload that is not a picture or a video', async () => {
    await admin.client
      .attach('/campaigns/creatives', 'file', Buffer.from('%PDF'), {
        filename: 'brief.pdf',
        contentType: 'application/pdf',
      })
      .expect(422);
  });

  it('requires campaigns.write', async () => {
    await connect();
    const agent = await createAdminUser(
      app,
      fixture.organizationId,
      fixture.storeId,
      'support_agent',
    );
    extraUsers.push(agent.id);

    await create(form(), randomUUID(), agent).expect(403);
    await agent.client
      .attach('/campaigns/creatives', 'file', Buffer.from('jpeg'), {
        filename: 'coat.jpg',
        contentType: 'image/jpeg',
      })
      .expect(403);
    expect(provider.creates).toHaveLength(0);

    const manager = await createAdminUser(
      app,
      fixture.organizationId,
      fixture.storeId,
      'product_manager',
    );
    extraUsers.push(manager.id);
    await create(form(), randomUUID(), manager).expect(201);
  });

  it('is impossible without a live connection', async () => {
    const never = await create(form()).expect(409);
    expect((never.body as { message: string }).message).toMatch(
      /not connected/,
    );

    await connect();
    await admin.client.post('/ad-platforms/meta/disconnect').expect(201);
    await create(form()).expect(409);

    expect(provider.validations).toHaveLength(0);
    expect(provider.creates).toHaveLength(0);
  });

  it('cannot use another organization’s product or image', async () => {
    const other = await seedStorefront(app);
    try {
      await connect();
      const res = await create(
        form({
          ads: [
            {
              ...form().ads[0],
              destinationProductId: other.productId,
            },
          ],
        }),
      ).expect(422);
      expect((res.body as Rejection).complaints[0]).toMatchObject({
        adIndex: 0,
        field: 'destination',
      });
      expect(provider.creates).toHaveLength(0);
    } finally {
      await destroyStorefront(app, other.organizationId);
    }
  });
});
