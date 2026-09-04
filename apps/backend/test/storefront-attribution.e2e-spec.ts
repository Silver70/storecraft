/**
 * Attribution, end to end: what a storefront declares about where a visitor
 * came from, and what survives onto the order it becomes.
 *
 * The whole point of this feature is that attribution is not retroactive — an
 * order that fails to record its evidence can never be attributed later — so
 * these tests assert on the rows as they were actually persisted, not on what
 * a mutation said it did. Everything runs through the real application against
 * a local Postgres database, reached only through the public storefront
 * GraphQL API.
 */
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { carts, orders } from '../src/shared/database/schema';
import { CartAttributionService } from '../src/modules/cart/services/cart-attribution.service';
import { createTestApp } from './helpers/test-app';
import {
  destroyStorefront,
  seedStorefront,
  type StorefrontFixture,
} from './helpers/storefront-fixture';

const CREATE_CART = /* GraphQL */ `
  mutation CreateCart($attribution: CartAttributionInput) {
    createCart(attribution: $attribution) {
      id
      attribution {
        source
        visitorId
        sessionId
        firstTouch {
          utmSource
          utmCampaign
        }
        lastTouch {
          utmSource
          utmCampaign
        }
      }
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
      attribution {
        source
        firstTouch {
          utmCampaign
        }
        lastTouch {
          utmCampaign
        }
      }
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

const A_WEEK_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

/** The ad that discovered the visitor, a week before they bought. */
const DISCOVERY_TOUCH = {
  utmSource: 'instagram',
  utmMedium: 'paid_social',
  utmCampaign: 'summer_sale',
  utmContent: 'story-variant-a',
  referrer: 'https://l.instagram.com/',
  landingPath: '/products/desk-fan',
  occurredAt: A_WEEK_AGO.toISOString(),
};

/** The retargeting ad that closed them, the day before. */
const CLOSING_TOUCH = {
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'retargeting_q3',
  utmContent: 'ad-group-2',
  referrer: 'https://www.google.com/',
  landingPath: '/cart',
  occurredAt: YESTERDAY.toISOString(),
};

describe('Storefront attribution (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let fixture: StorefrontFixture;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  beforeEach(async () => {
    fixture = await seedStorefront(app);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await destroyStorefront(app, fixture.organizationId);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createCart(
    at: StorefrontFixture,
    attribution?: Record<string, unknown>,
  ): Promise<string> {
    const { createCart: cart } = await at.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, attribution ? { attribution } : {});
    return cart.id;
  }

  async function checkout(
    at: StorefrontFixture,
    cartId: string,
  ): Promise<string> {
    await at.storefront.query(ADD_TO_CART, {
      cartId,
      variantId: at.variantId,
      quantity: 1,
    });
    const { checkout: result } = await at.storefront.query<{
      checkout: { orderId: string };
    }>(CHECKOUT, {
      cartId,
      input: {
        shippingMethodId: at.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'ada@example.test',
      },
    });
    return result.orderId;
  }

  const readCart = async (cartId: string) =>
    (await db.select().from(carts).where(eq(carts.id, cartId)))[0];

  const readOrder = async (orderId: string) =>
    (await db.select().from(orders).where(eq(orders.id, orderId)))[0];

  it('stores the declared first and last touch on the cart', async () => {
    const cartId = await createCart(fixture, {
      firstTouch: DISCOVERY_TOUCH,
      lastTouch: CLOSING_TOUCH,
      visitorId: 'visitor-abc',
      sessionId: 'session-xyz',
    });

    const cart = await readCart(cartId);

    expect(cart.attributionSource).toBe('declared');
    expect(cart.visitorId).toBe('visitor-abc');
    expect(cart.sessionId).toBe('session-xyz');

    expect(cart.firstTouchUtmSource).toBe('instagram');
    expect(cart.firstTouchUtmMedium).toBe('paid_social');
    expect(cart.firstTouchUtmCampaign).toBe('summer_sale');
    expect(cart.firstTouchUtmContent).toBe('story-variant-a');
    expect(cart.firstTouchReferrer).toBe('https://l.instagram.com/');
    expect(cart.firstTouchLandingPath).toBe('/products/desk-fan');

    expect(cart.lastTouchUtmSource).toBe('google');
    expect(cart.lastTouchUtmCampaign).toBe('retargeting_q3');
    expect(cart.lastTouchLandingPath).toBe('/cart');

    // The touches keep their declared order in time — the discovery ad came
    // first, which is the whole distinction between the two groups.
    expect(cart.firstTouchAt).not.toBeNull();
    expect(cart.lastTouchAt).not.toBeNull();
    expect(cart.firstTouchAt!.getTime()).toBeLessThan(
      cart.lastTouchAt!.getTime(),
    );
  });

  it('advances the last touch on a second arrival and leaves the first alone', async () => {
    const cartId = await createCart(fixture, {
      lastTouch: DISCOVERY_TOUCH,
      visitorId: 'visitor-abc',
    });

    const afterFirstArrival = await readCart(cartId);
    expect(afterFirstArrival.firstTouchUtmCampaign).toBe('summer_sale');
    expect(afterFirstArrival.lastTouchUtmCampaign).toBe('summer_sale');

    await fixture.storefront.query(RECORD_ATTRIBUTION, {
      cartId,
      attribution: {
        // A storefront re-sends the first touch it has stored alongside the
        // new one; the first must survive that untouched.
        firstTouch: DISCOVERY_TOUCH,
        lastTouch: CLOSING_TOUCH,
      },
    });

    const cart = await readCart(cartId);

    expect(cart.firstTouchUtmCampaign).toBe('summer_sale');
    expect(cart.firstTouchUtmSource).toBe('instagram');
    expect(cart.firstTouchAt!.getTime()).toBe(
      afterFirstArrival.firstTouchAt!.getTime(),
    );

    expect(cart.lastTouchUtmCampaign).toBe('retargeting_q3');
    expect(cart.lastTouchUtmSource).toBe('google');
    expect(cart.lastTouchAt!.getTime()).toBeGreaterThan(
      afterFirstArrival.lastTouchAt!.getTime(),
    );
  });

  it('copies both touch groups onto the order at checkout', async () => {
    const cartId = await createCart(fixture, {
      firstTouch: DISCOVERY_TOUCH,
      lastTouch: CLOSING_TOUCH,
      visitorId: 'visitor-abc',
      sessionId: 'session-xyz',
    });

    const orderId = await checkout(fixture, cartId);

    const cart = await readCart(cartId);
    const order = await readOrder(orderId);

    expect(order.attributionSource).toBe('declared');
    expect(order.visitorId).toBe('visitor-abc');
    expect(order.sessionId).toBe('session-xyz');

    expect(order.firstTouchUtmSource).toBe('instagram');
    expect(order.firstTouchUtmMedium).toBe('paid_social');
    expect(order.firstTouchUtmCampaign).toBe('summer_sale');
    expect(order.firstTouchUtmContent).toBe('story-variant-a');
    expect(order.firstTouchReferrer).toBe('https://l.instagram.com/');
    expect(order.firstTouchLandingPath).toBe('/products/desk-fan');
    expect(order.firstTouchAt!.getTime()).toBe(cart.firstTouchAt!.getTime());

    expect(order.lastTouchUtmSource).toBe('google');
    expect(order.lastTouchUtmMedium).toBe('cpc');
    expect(order.lastTouchUtmCampaign).toBe('retargeting_q3');
    expect(order.lastTouchUtmContent).toBe('ad-group-2');
    expect(order.lastTouchReferrer).toBe('https://www.google.com/');
    expect(order.lastTouchLandingPath).toBe('/cart');
    expect(order.lastTouchAt!.getTime()).toBe(cart.lastTouchAt!.getTime());
  });

  it('leaves a placed order alone when the cart is attributed again afterwards', async () => {
    const cartId = await createCart(fixture, { lastTouch: DISCOVERY_TOUCH });
    const orderId = await checkout(fixture, cartId);

    const asPurchased = await readOrder(orderId);
    expect(asPurchased.lastTouchUtmCampaign).toBe('summer_sale');

    // The same visitor comes back through a different ad. The cart may learn
    // about it; the order they already placed must not.
    await fixture.storefront.query(RECORD_ATTRIBUTION, {
      cartId,
      attribution: { lastTouch: CLOSING_TOUCH },
    });

    expect(await readCart(cartId)).toMatchObject({
      lastTouchUtmCampaign: 'retargeting_q3',
    });

    const order = await readOrder(orderId);
    expect(order.attributionSource).toBe(asPurchased.attributionSource);
    expect(order.firstTouchUtmCampaign).toBe('summer_sale');
    expect(order.lastTouchUtmCampaign).toBe('summer_sale');
    expect(order.lastTouchAt!.getTime()).toBe(
      asPurchased.lastTouchAt!.getTime(),
    );
  });

  it('checks out normally with no attribution at all, recording the order as unattributed', async () => {
    const cartId = await createCart(fixture);
    const cart = await readCart(cartId);
    expect(cart.attributionSource).toBe('none');
    expect(cart.firstTouchAt).toBeNull();
    expect(cart.lastTouchAt).toBeNull();

    const orderId = await checkout(fixture, cartId);
    const order = await readOrder(orderId);

    expect(order.attributionSource).toBe('none');
    expect(order.firstTouchUtmCampaign).toBeNull();
    expect(order.lastTouchUtmCampaign).toBeNull();
    expect(order.firstTouchAt).toBeNull();
    expect(order.lastTouchAt).toBeNull();
    expect(order.total).toBe(fixture.variantPrice + fixture.shippingPrice);
  });

  it('accepts a partial declaration, and a direct arrival records no touch', async () => {
    // Every field is optional: a storefront that knows only a session id, or
    // only that the visitor arrived direct, must still get a working cart.
    const sessionOnly = await createCart(fixture, { sessionId: 'session-1' });
    expect(await readCart(sessionOnly)).toMatchObject({
      attributionSource: 'none',
      sessionId: 'session-1',
      firstTouchAt: null,
    });

    const direct = await createCart(fixture, {
      lastTouch: { landingPath: '/' },
    });
    expect(await readCart(direct)).toMatchObject({
      attributionSource: 'none',
      firstTouchAt: null,
      lastTouchAt: null,
    });

    const empty = await createCart(fixture, { firstTouch: {}, lastTouch: {} });
    expect(await readCart(empty)).toMatchObject({ attributionSource: 'none' });

    // A campaign with no other detail is still evidence.
    const utmOnly = await createCart(fixture, {
      lastTouch: { utmCampaign: 'summer_sale' },
    });
    expect(await readCart(utmOnly)).toMatchObject({
      attributionSource: 'declared',
      firstTouchUtmCampaign: 'summer_sale',
      lastTouchUtmCampaign: 'summer_sale',
    });
  });

  it('never lets attribution cross an organization boundary', async () => {
    const other = await seedStorefront(app);
    try {
      const cartId = await createCart(fixture, { lastTouch: DISCOVERY_TOUCH });

      // Another tenant's API key must not be able to see or rewrite it.
      const response = await other.storefront.raw(RECORD_ATTRIBUTION, {
        cartId,
        attribution: { lastTouch: CLOSING_TOUCH },
      });
      const body = response.body as { errors?: { message: string }[] };
      expect(body.errors?.[0]?.message).toMatch(/Cart not found/);

      expect(await readCart(cartId)).toMatchObject({
        lastTouchUtmCampaign: 'summer_sale',
      });

      // And the other tenant's own orders carry only their own evidence.
      const theirOrderId = await checkout(other, await createCart(other));
      const theirOrder = await readOrder(theirOrderId);
      expect(theirOrder.organizationId).toBe(other.organizationId);
      expect(theirOrder.attributionSource).toBe('none');
      expect(theirOrder.lastTouchUtmCampaign).toBeNull();

      const [strayCart] = await db
        .select()
        .from(carts)
        .where(
          and(
            eq(carts.id, cartId),
            eq(carts.organizationId, other.organizationId),
          ),
        );
      expect(strayCart).toBeUndefined();
    } finally {
      await destroyStorefront(app, other.organizationId);
    }
  });

  it('still completes the sale when attribution cannot be resolved', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn(app.get(CartAttributionService), 'resolveForOrder')
      .mockRejectedValue(new Error('attribution backend is down'));

    const cartId = await createCart(fixture, { lastTouch: DISCOVERY_TOUCH });
    const orderId = await checkout(fixture, cartId);

    const order = await readOrder(orderId);
    expect(order.total).toBe(fixture.variantPrice + fixture.shippingPrice);
    // A reporting failure costs a line in a report, never the sale — the order
    // exists, and falls into the Unattributed bucket.
    expect(order.attributionSource).toBe('none');
    expect(order.lastTouchUtmCampaign).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('Attribution could not be resolved'),
      expect.anything(),
    );
  });
});
