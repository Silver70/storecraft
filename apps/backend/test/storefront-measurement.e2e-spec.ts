/**
 * The pixel in the storefront, end to end.
 *
 * The claim this ticket makes is that measurement is switched on by connecting
 * an ad platform and off by disconnecting, with no storefront deploy and no
 * storefront configuration in between — so what is asserted here is the answer
 * the storefront actually gets when it asks, against a real database, through
 * the public GraphQL API, with only the `X-API-Key` that names the Store.
 *
 * The second half is the evidence that has to survive the sale: Meta's browser
 * identifiers and the visitor's consent answer travel with the cart the way
 * attribution already does and are frozen onto the Order at checkout. They are
 * asserted on the persisted row rather than on what a mutation replied, because
 * an Order that failed to record them can never be told later — the cookie and
 * the `fbclid` are gone by then, and ticket 06 has nothing to report with.
 *
 * Connections are seeded as rows; the flow that writes them is ticket 04's
 * spec. Everything else is production wiring against local Postgres.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  adPlatformConnections,
  orders,
  type AdPlatformConnectionStatus,
} from '../src/shared/database/schema';
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

const MEASUREMENT_SETTINGS = /* GraphQL */ `
  query MeasurementSettings {
    measurementSettings {
      pixelId
      consentRequired
    }
  }
`;

const CREATE_CART = /* GraphQL */ `
  mutation CreateCart($attribution: CartAttributionInput) {
    createCart(attribution: $attribution) {
      id
    }
  }
`;

const RECORD_ATTRIBUTION = /* GraphQL */ `
  mutation RecordCartAttribution(
    $cartId: ID!
    $attribution: CartAttributionInput!
  ) {
    recordCartAttribution(cartId: $cartId, attribution: $attribution) {
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

/** As Meta's own pixel would have written them. */
const FBP = 'fb.1.1757000000000.1234567890';
const FBC = 'fb.1.1757000000000.IwAR0abcdef';

interface MeasurementSettings {
  pixelId: string | null;
  consentRequired: boolean;
}

describe('The pixel in the starter storefront (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // One Store reached two ways: the storefront asks what it may measure, the
    // merchant sets the switch through the admin. That is the shape of the claim.
    fixture = await seedStorefront(app);
    admin = await createAdminUser(app, fixture.organizationId, fixture.storeId);
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
    await destroyAdminUsers(app, [admin.id]);
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** What the storefront is told, asked exactly as the storefront asks it. */
  async function readMeasurement(
    at: StorefrontFixture = fixture,
  ): Promise<MeasurementSettings> {
    const { measurementSettings } = await at.storefront.query<{
      measurementSettings: MeasurementSettings;
    }>(MEASUREMENT_SETTINGS);
    return measurementSettings;
  }

  /** A connected Meta ad account with a pixel, as ticket 04's flow leaves it. */
  async function connectMeta(
    pixelId: string | null,
    at: StorefrontFixture = fixture,
    status: AdPlatformConnectionStatus = 'connected',
  ): Promise<void> {
    await db.insert(adPlatformConnections).values({
      organizationId: at.organizationId,
      storeId: at.storeId,
      platform: 'meta',
      providerAccountRef: 'profile_e2e',
      externalAccountId: 'act_e2e',
      accountName: 'E2E Ads',
      accountCurrency: at.currency,
      pixelId,
      status,
    });
  }

  const disconnectMeta = (at: StorefrontFixture = fixture) =>
    db
      .update(adPlatformConnections)
      .set({ status: 'disconnected', disconnectedAt: new Date() })
      .where(eq(adPlatformConnections.storeId, at.storeId));

  /** Turns the consent switch on through the admin, as a merchant does. */
  const setConsentRequired = (required: boolean) =>
    admin.client
      .patch(`/stores/${fixture.storeId}`, {
        requiresMeasurementConsent: required,
      })
      .expect(200);

  async function createCart(
    attribution?: Record<string, unknown>,
  ): Promise<string> {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, attribution ? { attribution } : {});
    return cart.id;
  }

  async function checkout(cartId: string): Promise<string> {
    await fixture.storefront.query(ADD_TO_CART, {
      cartId,
      variantId: fixture.variantId,
      quantity: 1,
    });
    const { checkout: result } = await fixture.storefront.query<{
      checkout: { orderId: string };
    }>(CHECKOUT, {
      cartId,
      input: {
        shippingMethodId: fixture.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'ada@example.test',
      },
    });
    return result.orderId;
  }

  const readOrder = async (orderId: string) =>
    (await db.select().from(orders).where(eq(orders.id, orderId)))[0];

  // ─── Which pixel, if any ────────────────────────────────────────────────────

  describe('which pixel the storefront loads', () => {
    it('tells a store with no connection to load nothing', async () => {
      expect(await readMeasurement()).toEqual({
        pixelId: null,
        consentRequired: false,
      });
    });

    it("serves the connected ad account's pixel", async () => {
      await connectMeta('pixel_1234567890');

      expect((await readMeasurement()).pixelId).toBe('pixel_1234567890');
    });

    it('stops serving it the moment the merchant disconnects', async () => {
      await connectMeta('pixel_1234567890');
      expect((await readMeasurement()).pixelId).toBe('pixel_1234567890');

      // No deploy, no storefront change: the same question, a different answer.
      await disconnectMeta();

      expect((await readMeasurement()).pixelId).toBeNull();
    });

    it('serves nothing for a connection still waiting for its ad account', async () => {
      await connectMeta(null, fixture, 'awaiting_account');

      expect((await readMeasurement()).pixelId).toBeNull();
    });

    it("never serves another organization's pixel", async () => {
      const other = await seedStorefront(app);
      try {
        await connectMeta('pixel_theirs', other);

        // Their key reads their pixel; ours reads nothing, because we have no
        // connection — not a shared one, not theirs.
        expect((await readMeasurement(other)).pixelId).toBe('pixel_theirs');
        expect((await readMeasurement()).pixelId).toBeNull();
      } finally {
        await destroyStorefront(app, other.organizationId);
      }
    });
  });

  // ─── The consent switch ─────────────────────────────────────────────────────

  describe('the consent switch', () => {
    it('is off until a merchant turns it on, so no banner appears', async () => {
      expect((await readMeasurement()).consentRequired).toBe(false);
    });

    it('is settable in the admin and read by the storefront', async () => {
      await setConsentRequired(true);
      expect((await readMeasurement()).consentRequired).toBe(true);

      await setConsentRequired(false);
      expect((await readMeasurement()).consentRequired).toBe(false);
    });

    it('is independent of whether anything is connected', async () => {
      await setConsentRequired(true);
      await connectMeta('pixel_1234567890');

      expect(await readMeasurement()).toEqual({
        pixelId: 'pixel_1234567890',
        consentRequired: true,
      });
    });
  });

  // ─── What survives onto the order ───────────────────────────────────────────

  describe('the browser identifiers and the answer', () => {
    it('freezes them onto the order at checkout', async () => {
      const cartId = await createCart({
        lastTouch: {
          utmSource: 'meta',
          utmMedium: 'paid',
          utmCampaign: '120200000000000001',
          utmContent: '120210000000000001',
        },
        metaBrowserId: FBP,
        metaClickId: FBC,
        measurementConsent: 'granted',
      });

      const order = await readOrder(await checkout(cartId));

      expect(order.metaBrowserId).toBe(FBP);
      expect(order.metaClickId).toBe(FBC);
      expect(order.measurementConsent).toBe('granted');
    });

    it('freezes a refusal, which is the answer that has to survive', async () => {
      // A visitor who declined carries no identifiers, because none was ever
      // written for them. What must reach the Order is the "no" itself.
      const cartId = await createCart({ measurementConsent: 'denied' });

      const order = await readOrder(await checkout(cartId));

      expect(order.measurementConsent).toBe('denied');
      expect(order.metaBrowserId).toBeNull();
      expect(order.metaClickId).toBeNull();
    });

    it('records an answer given after the cart already existed', async () => {
      const cartId = await createCart({ visitorId: 'visitor-abc' });

      // The banner is answered on the cart page, days into the visit.
      await fixture.storefront.query(RECORD_ATTRIBUTION, {
        cartId,
        attribution: { measurementConsent: 'granted', metaBrowserId: FBP },
      });

      const order = await readOrder(await checkout(cartId));

      expect(order.measurementConsent).toBe('granted');
      expect(order.metaBrowserId).toBe(FBP);
    });

    it('leaves an order that declared none of it unmeasured, not failed', async () => {
      const order = await readOrder(await checkout(await createCart()));

      expect(order.metaBrowserId).toBeNull();
      expect(order.metaClickId).toBeNull();
      expect(order.measurementConsent).toBeNull();
    });

    it('never fails a sale over an answer it does not recognise', async () => {
      const cartId = await createCart({
        metaBrowserId: FBP,
        measurementConsent: 'granted',
      });

      // A storefront sending nonsense is refused the value, not the checkout.
      await expect(
        fixture.storefront.query(RECORD_ATTRIBUTION, {
          cartId,
          attribution: { measurementConsent: 'maybe' },
        }),
      ).rejects.toThrow();

      const order = await readOrder(await checkout(cartId));

      expect(order.measurementConsent).toBe('granted');
      expect(order.metaBrowserId).toBe(FBP);
    });
  });
});
