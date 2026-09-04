/**
 * The storefront purchase path, end to end: create a Cart, add a variant,
 * check out, and assert the Order that comes out the other side.
 *
 * Everything here is the real application — the same guards, resolvers,
 * services and repositories that serve production traffic — running against a
 * local Postgres database, reached only through the public storefront GraphQL
 * API. The one substitution is the payment provider, which would otherwise call
 * Stripe over the network.
 *
 * This exercises behaviour that already works. It exists so that later work on
 * attribution has a seam to prove itself at, and so a regression anywhere along
 * cart → pricing → inventory → order shows up as a failing test rather than as
 * a broken checkout.
 */
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import { carts, orderLineItems, orders } from '../src/shared/database/schema';
import { createTestApp } from './helpers/test-app';
import type { FakePaymentProvider } from './helpers/fake-payment-provider';
import {
  destroyStorefront,
  seedStorefront,
  type StorefrontFixture,
} from './helpers/storefront-fixture';

const CREATE_CART = /* GraphQL */ `
  mutation CreateCart {
    createCart {
      id
      status
      currency
      subtotal
      total
    }
  }
`;

const ADD_TO_CART = /* GraphQL */ `
  mutation AddToCart($cartId: ID!, $variantId: ID!, $quantity: Int!) {
    addToCart(cartId: $cartId, variantId: $variantId, quantity: $quantity) {
      id
      subtotal
      total
      items {
        id
        variantId
        quantity
        unitPrice
        totalPrice
        sku
        productName
      }
    }
  }
`;

const CHECKOUT = /* GraphQL */ `
  mutation Checkout($cartId: ID!, $input: CheckoutInput!) {
    checkout(cartId: $cartId, input: $input) {
      orderId
      orderNumber
      total
      currency
      paymentClientSecret
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
const QUANTITY = 2;
const EXPECTED_TOTAL = VARIANT_PRICE * QUANTITY + SHIPPING_PRICE;

describe('Storefront checkout (e2e)', () => {
  let app: INestApplication<App>;
  let payments: FakePaymentProvider;
  let db: DrizzleClient;
  let fixture: StorefrontFixture;

  beforeAll(async () => {
    ({ app, payments } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  beforeEach(async () => {
    fixture = await seedStorefront(app, {
      variantPrice: VARIANT_PRICE,
      shippingPrice: SHIPPING_PRICE,
    });
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('turns a cart into an order with the expected total', async () => {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string; status: string; currency: string };
    }>(CREATE_CART);

    expect(cart.status).toBe('active');
    expect(cart.currency).toBe(fixture.currency);

    const { addToCart: withItem } = await fixture.storefront.query<{
      addToCart: {
        subtotal: number;
        items: {
          variantId: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          sku: string;
          productName: string;
        }[];
      };
    }>(ADD_TO_CART, {
      cartId: cart.id,
      variantId: fixture.variantId,
      quantity: QUANTITY,
    });

    expect(withItem.items).toHaveLength(1);
    expect(withItem.items[0]).toMatchObject({
      variantId: fixture.variantId,
      quantity: QUANTITY,
      unitPrice: VARIANT_PRICE,
      totalPrice: VARIANT_PRICE * QUANTITY,
      sku: fixture.sku,
      productName: fixture.productName,
    });
    expect(withItem.subtotal).toBe(VARIANT_PRICE * QUANTITY);

    const { checkout } = await fixture.storefront.query<{
      checkout: {
        orderId: string;
        orderNumber: string;
        total: number;
        currency: string;
        paymentClientSecret: string;
      };
    }>(CHECKOUT, {
      cartId: cart.id,
      input: {
        shippingMethodId: fixture.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'ada@example.test',
      },
    });

    expect(checkout.total).toBe(EXPECTED_TOTAL);
    expect(checkout.currency).toBe(fixture.currency);
    expect(checkout.orderNumber).toMatch(/^ORD-/);
    expect(checkout.paymentClientSecret).not.toBe('');

    // The order as it was actually persisted, not as the mutation described it.
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, checkout.orderId),
          eq(orders.organizationId, fixture.organizationId),
          eq(orders.storeId, fixture.storeId),
        ),
      );

    expect(order).toBeDefined();
    expect(order.status).toBe('pending');
    expect(order.subtotal).toBe(VARIANT_PRICE * QUANTITY);
    expect(order.shippingAmount).toBe(SHIPPING_PRICE);
    expect(order.discountAmount).toBe(0);
    expect(order.taxAmount).toBe(0);
    expect(order.total).toBe(EXPECTED_TOTAL);
    expect(order.customerEmail).toBe('ada@example.test');

    // Line items are immutable snapshots taken at order creation.
    const lineItems = await db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, order.id));

    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]).toMatchObject({
      variantId: fixture.variantId,
      sku: fixture.sku,
      productName: fixture.productName,
      quantity: QUANTITY,
      unitPrice: VARIANT_PRICE,
      totalPrice: VARIANT_PRICE * QUANTITY,
    });

    // The cart is spent — checking out twice must not be possible.
    const [convertedCart] = await db
      .select()
      .from(carts)
      .where(eq(carts.id, cart.id));
    expect(convertedCart.status).toBe('converted');

    // The full total reached the payment leg, in minor units.
    const intent = payments.createdIntents.at(-1);
    expect(intent?.amount).toBe(EXPECTED_TOTAL);
    expect(intent?.currency).toBe(fixture.currency);
    expect(intent?.metadata).toMatchObject({
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      orderId: order.id,
    });
  });

  it('rejects a storefront request with no API key', async () => {
    const response = await fixture.storefront
      .raw(CREATE_CART)
      .set('X-API-Key', '');

    const body = response.body as { errors?: { message: string }[] };
    expect(body.errors?.[0]?.message).toMatch(/X-API-Key/);
  });

  it('leaves no rows behind once a fixture is torn down', async () => {
    const scratch = await seedStorefront(app);

    const { createCart: cart } = await scratch.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART);
    await scratch.storefront.query(ADD_TO_CART, {
      cartId: cart.id,
      variantId: scratch.variantId,
      quantity: 1,
    });
    await scratch.storefront.query(CHECKOUT, {
      cartId: cart.id,
      input: {
        shippingMethodId: scratch.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: 'scratch@example.test',
      },
    });

    await destroyStorefront(app, scratch.organizationId);

    const remainingOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.organizationId, scratch.organizationId));
    const remainingCarts = await db
      .select()
      .from(carts)
      .where(eq(carts.organizationId, scratch.organizationId));

    expect(remainingOrders).toHaveLength(0);
    expect(remainingCarts).toHaveLength(0);
  });
});
