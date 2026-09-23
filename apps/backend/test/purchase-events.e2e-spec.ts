/**
 * Purchases flowing back to the ad platform, end to end.
 *
 * The claim this ticket makes is that every paid Order is reported from our own
 * server exactly once, that reporting can never cost a sale, and that a purchase
 * nobody agreed to be measured for is never reported at all. So the seam runs
 * from a real checkout through the storefront API, through the real payment
 * transition, to whatever the provider was actually handed — the in-memory fake,
 * swapped in at the provider token exactly as the payment fake is, with
 * everything else production wiring against local Postgres.
 *
 * The connection is made by driving ticket 04's real flow rather than by inserting
 * a row, because the credential and the Pixel that flow writes are two of the
 * things a dispatch needs, and a seeded row would prove the dispatch works
 * against a connection no merchant could have made.
 *
 * **The schedule is not tested.** That a `@Cron` decorator fires is the
 * framework's; the dispatcher is a plain public method and is invoked as one,
 * with `now` passed in so a retry after a lease does not need a test to wait ten
 * minutes for one.
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
  orders,
  purchaseEventDispatches,
  type PurchaseEventDispatch,
} from '../src/shared/database/schema';
import { PurchaseEventService } from '../src/modules/ad-platform/services/purchase-event.service';
import { PurchaseEventDispatchRepository } from '../src/modules/ad-platform/repositories/purchase-event-dispatch.repository';
import { CLAIM_LEASE_MINUTES } from '../src/modules/ad-platform/utils/purchase-dispatch.util';
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
  phone: '+1 415 555 1234',
};

const EMAIL = 'Ada@Example.test';

/** As Meta's own pixel would have written them. */
const FBP = 'fb.1.1757000000000.1234567890';
const FBC = 'fb.1.1757000000000.IwAR0abcdef';

const minutesFromNow = (minutes: number): Date =>
  new Date(Date.now() + minutes * 60 * 1000);

describe('Server-side purchase events (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let purchases: PurchaseEventService;
  let dispatches: PurchaseEventDispatchRepository;
  let fixture: StorefrontFixture;
  let admin: AdminUserFixture;

  beforeAll(async () => {
    ({ app, adPlatform: provider } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
    purchases = app.get(PurchaseEventService);
    dispatches = app.get(PurchaseEventDispatchRepository);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    provider.reset();
    // One Store reached both ways: a shopper buys through the storefront API, the
    // merchant connects and configures through the admin. That is the shape of
    // the claim.
    fixture = await seedStorefront(app);
    admin = await createAdminUser(app, fixture.organizationId, fixture.storeId);
  });

  afterEach(async () => {
    await destroyStorefront(app, fixture.organizationId);
    await destroyAdminUsers(app, [admin.id]);
  });

  // ─── Driving it the way a merchant and a shopper do ─────────────────────────

  /** Ticket 04's connection flow, ending with an ad account and a Pixel. */
  async function connectMeta(): Promise<{ pixelId: string }> {
    const res = await admin.client
      .post('/ad-platforms/meta/connect')
      .expect(201);
    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = new URL(
      decodeURIComponent(new URL(approvalUrl).searchParams.get('return') ?? ''),
    );

    const { providerRef } = provider.begun[provider.begun.length - 1];
    provider.approve(providerRef, 'meta', [{ currency: fixture.currency }]);

    await request(app.getHttpServer())
      .get(`${returnUrl.pathname}${returnUrl.search}`)
      .expect(302);

    const pixel = provider.pixels[provider.pixels.length - 1];
    expect(pixel).toBeDefined();
    return { pixelId: pixel.pixelId };
  }

  /** Turns the consent switch on, as a merchant selling into the EU does. */
  const requireConsent = () =>
    admin.client
      .patch(`/stores/${fixture.storeId}`, { requiresMeasurementConsent: true })
      .expect(200);

  /** A real checkout, declaring whatever this case says the browser captured. */
  async function buy(
    attribution?: Record<string, unknown>,
  ): Promise<{ orderId: string; total: number }> {
    const { createCart: cart } = await fixture.storefront.query<{
      createCart: { id: string };
    }>(CREATE_CART, attribution ? { attribution } : {});

    await fixture.storefront.query(ADD_TO_CART, {
      cartId: cart.id,
      variantId: fixture.variantId,
      quantity: 1,
    });

    const { checkout } = await fixture.storefront.query<{
      checkout: { orderId: string; total: number };
    }>(CHECKOUT, {
      cartId: cart.id,
      input: {
        shippingMethodId: fixture.shippingMethodId,
        shippingAddress: SHIPPING_ADDRESS,
        email: EMAIL,
      },
    });
    return checkout;
  }

  /** The payment landing, which is what a purchase is. */
  const markPaid = (orderId: string) =>
    admin.client
      .patch(`/orders/${orderId}/status`, { status: 'paid' })
      .expect(200);

  const readOrder = async (orderId: string) =>
    (await db.select().from(orders).where(eq(orders.id, orderId)))[0];

  const readDispatch = (orderId: string) =>
    dispatches.findByOrder(fixture.organizationId, orderId);

  /**
   * Waits for the dispatch the payment set off to have finished happening.
   *
   * The Order's status change is emitted without being awaited — deliberately, so
   * that nothing a shopper or an admin is waiting on is held up by an ad platform
   * — which means the handler it wakes settles a moment after the request that
   * caused it has returned. This is the seam between "fire and forget" and "assert
   * what happened", and there is no other honest place to put it.
   *
   * Settled means the row has stopped moving: reported, withheld, expired, or
   * still owed *with a reason recorded*. A bare `pending` row is a claim whose
   * send is still in flight, and asserting on one would be asserting on a
   * half-written outcome.
   */
  async function settledDispatch(
    orderId: string,
  ): Promise<PurchaseEventDispatch> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const row = await readDispatch(orderId);
      if (row && (row.state !== 'pending' || row.lastError !== null))
        return row;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no dispatch ever settled for order ${orderId}`);
  }

  /** Long enough for a handler that was going to do something to have done it. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

  // ─── One purchase, reported once ────────────────────────────────────────────

  describe('a paid order', () => {
    it('reports one purchase carrying its total, currency, id and contact details', async () => {
      const { pixelId } = await connectMeta();
      const { orderId, total } = await buy({
        metaBrowserId: FBP,
        metaClickId: FBC,
      });

      await markPaid(orderId);
      await settledDispatch(orderId);

      expect(provider.purchases).toHaveLength(1);
      const [reported] = provider.purchases;
      expect(reported.pixelId).toBe(pixelId);
      expect(reported.event).toMatchObject({
        // The Order's id, which is also the event id the browser's copy carries.
        // These two being one value is the whole of "counted once".
        eventId: orderId,
        value: total,
        currency: fixture.currency,
        // Lowercased, because a hash is unforgiving about the case a shopper typed.
        email: 'ada@example.test',
        phone: '+14155551234',
        origin: 'storefront',
      });
    });

    it("includes the platform's browser identifiers frozen on the order", async () => {
      await connectMeta();
      const { orderId } = await buy({ metaBrowserId: FBP, metaClickId: FBC });

      await markPaid(orderId);
      await settledDispatch(orderId);

      expect(provider.purchases[0].event).toMatchObject({
        browserId: FBP,
        clickId: FBC,
      });
    });

    it('reports a purchase that carried no identifiers rather than skipping it', async () => {
      // A visitor whose pixel was blocked. The platform can still match on the
      // contact details, and a sale withheld because it was hard to match is a
      // sale the platform is taught did not happen.
      await connectMeta();
      const { orderId } = await buy();

      await markPaid(orderId);
      await settledDispatch(orderId);

      expect(provider.purchases).toHaveLength(1);
      expect(provider.purchases[0].event).toMatchObject({
        browserId: null,
        clickId: null,
      });
    });

    it('records the dispatch against the order, sent', async () => {
      await connectMeta();
      const { orderId } = await buy();

      await markPaid(orderId);
      const dispatch = await settledDispatch(orderId);

      expect(dispatch).toMatchObject({
        state: 'sent',
        attemptCount: 1,
        lastError: null,
      });
      expect(dispatch.sentAt).not.toBeNull();
    });

    it('is not reported a second time, however often the job runs', async () => {
      await connectMeta();
      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      // Three more passes, one of them well past the claim lease, so nothing is
      // being held back merely by a lease that had not expired.
      await purchases.dispatchDue();
      await purchases.dispatchDue();
      await purchases.dispatchDue(minutesFromNow(CLAIM_LEASE_MINUTES + 5));

      expect(provider.purchases).toHaveLength(1);
      expect((await readDispatch(orderId))?.attemptCount).toBe(1);
    });

    it('is reported once when it moves on through fulfilment', async () => {
      await connectMeta();
      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      // Processing and shipping are the same purchase. Reporting one per status
      // change would multiply a merchant's sales by their workflow.
      await admin.client
        .patch(`/orders/${orderId}/status`, { status: 'processing' })
        .expect(200);
      await admin.client
        .patch(`/orders/${orderId}/status`, { status: 'shipped' })
        .expect(200);
      await settle();

      expect(provider.purchases).toHaveLength(1);
    });
  });

  // ─── The job is the record, not the listener ─────────────────────────────────

  describe('the scheduled pass', () => {
    it('reports a paid order that was never queued at all', async () => {
      // A restart between the payment and the handler. The queue is self-healing
      // by design: the pass looks for paid Orders, not only for rows somebody
      // remembered to write, or a sale would be lost to a deployment.
      await connectMeta();
      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      await db
        .delete(purchaseEventDispatches)
        .where(eq(purchaseEventDispatches.orderId, orderId));
      provider.purchases.length = 0;

      const summary = await purchases.dispatchDue();

      expect(summary.sent).toBe(1);
      expect(provider.purchases).toHaveLength(1);
      expect(provider.purchases[0].event.eventId).toBe(orderId);
    });

    it('leaves an unpaid order alone', async () => {
      await connectMeta();
      const { orderId } = await buy();

      await settle();
      const summary = await purchases.dispatchDue();

      expect(summary.sent).toBe(0);
      expect(provider.purchases).toHaveLength(0);
      expect(await readDispatch(orderId)).toBeNull();
    });
  });

  // ─── A provider that is not answering ───────────────────────────────────────

  describe('when the platform cannot be reached', () => {
    it('does not fail the sale, and leaves the order paid', async () => {
      await connectMeta();
      provider.failAlways = new Error('the ad platform is down');

      // The purchase itself must be unaffected: a shopper who paid has paid, and
      // a report is evidence rather than a dependency.
      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      expect((await readOrder(orderId)).status).toBe('paid');
    });

    it('leaves the purchase owed, with the attempt and the reason recorded', async () => {
      await connectMeta();
      provider.failAlways = new Error('the ad platform is down');

      const { orderId } = await buy();
      await markPaid(orderId);
      const dispatch = await settledDispatch(orderId);

      expect(dispatch).toMatchObject({ state: 'pending', attemptCount: 1 });
      expect(dispatch.lastError).toBeTruthy();
      expect(dispatch.sentAt).toBeNull();
    });

    it('reports it on the next pass once the platform answers again', async () => {
      await connectMeta();
      provider.failAlways = new Error('the ad platform is down');

      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      provider.failAlways = null;
      // Past the claim lease, which is what the hourly schedule would be.
      const summary = await purchases.dispatchDue(
        minutesFromNow(CLAIM_LEASE_MINUTES + 5),
      );

      expect(summary.sent).toBe(1);
      expect(provider.purchases).toHaveLength(1);
      expect(await readDispatch(orderId)).toMatchObject({
        state: 'sent',
        attemptCount: 2,
        lastError: null,
      });
    });

    it('does not retry inside the lease, so two writers never both report it', async () => {
      await connectMeta();
      provider.failAlways = new Error('the ad platform is down');

      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);
      provider.failAlways = null;

      // A pass moments later: the row is somebody else's claim as far as this one
      // can tell, and it may still be in flight. It is not even offered to the
      // dispatcher — the lease is part of the query that looks for owed
      // purchases, so a leased row is never picked up and then put back.
      const summary = await purchases.dispatchDue();

      expect(summary.sent).toBe(0);
      expect(provider.purchases).toHaveLength(0);
      expect((await readDispatch(orderId))?.attemptCount).toBe(1);
    });
  });

  // ─── Consent ────────────────────────────────────────────────────────────────

  describe('a store that asks before it measures', () => {
    it('reports nothing for a visitor who declined', async () => {
      await connectMeta();
      await requireConsent();

      const { orderId } = await buy({ measurementConsent: 'denied' });
      await markPaid(orderId);

      expect(await settledDispatch(orderId)).toMatchObject({
        state: 'withheld',
        attemptCount: 0,
      });
      expect(provider.purchases).toHaveLength(0);
    });

    it('reports nothing for a visitor who was never asked', async () => {
      // An Order placed before the switch went on, or by somebody who scrolled
      // past the banner. Neither is a yes, and an email address is personal data
      // exactly as a page view is.
      await connectMeta();
      await requireConsent();

      const { orderId } = await buy();
      await markPaid(orderId);

      expect(await settledDispatch(orderId)).toMatchObject({
        state: 'withheld',
      });
      expect(provider.purchases).toHaveLength(0);
    });

    it('never reconsiders a withheld purchase, however often the job runs', async () => {
      await connectMeta();
      await requireConsent();

      const { orderId } = await buy({ measurementConsent: 'denied' });
      await markPaid(orderId);
      await settledDispatch(orderId);

      await purchases.dispatchDue(minutesFromNow(CLAIM_LEASE_MINUTES + 5));

      expect(provider.purchases).toHaveLength(0);
      expect((await readDispatch(orderId))?.state).toBe('withheld');
    });

    it('reports the purchase of a visitor who accepted', async () => {
      await connectMeta();
      await requireConsent();

      const { orderId } = await buy({
        measurementConsent: 'granted',
        metaBrowserId: FBP,
      });
      await markPaid(orderId);
      await settledDispatch(orderId);

      expect(provider.purchases).toHaveLength(1);
      expect(provider.purchases[0].event.browserId).toBe(FBP);
    });

    it('reports every sale on a store that does not ask', async () => {
      // The default. A store selling only where consent is not required is not
      // made worse for it.
      await connectMeta();

      const { orderId } = await buy({ measurementConsent: 'denied' });
      await markPaid(orderId);
      await settledDispatch(orderId);

      expect(provider.purchases).toHaveLength(1);
    });
  });

  // ─── A store with nothing connected ─────────────────────────────────────────

  describe('a store with no connection', () => {
    it('dispatches nothing and queues nothing', async () => {
      const { orderId } = await buy({ metaBrowserId: FBP });

      await markPaid(orderId);
      await settle();
      const summary = await purchases.dispatchDue();

      expect(provider.purchases).toHaveLength(0);
      expect(summary).toMatchObject({ sent: 0, withheld: 0, failed: 0 });
      // No ledger of purchases owed to nobody.
      expect(await readDispatch(orderId)).toBeNull();
    });

    it('stops reporting once the merchant disconnects', async () => {
      await connectMeta();
      await admin.client.post('/ad-platforms/meta/disconnect').expect(201);
      provider.purchases.length = 0;

      const { orderId } = await buy();
      await markPaid(orderId);
      await settle();
      await purchases.dispatchDue();

      expect(provider.purchases).toHaveLength(0);
      expect(await readDispatch(orderId)).toBeNull();
    });
  });

  // ─── The window closing ─────────────────────────────────────────────────────

  describe('a purchase the platform can no longer attribute', () => {
    it('is closed off rather than retried forever', async () => {
      // A week of the platform refusing. Past its attribution window the event
      // would be accepted and attributed to nobody, so sending it would be a
      // customer's contact details spent on nothing.
      await connectMeta();
      provider.failAlways = new Error('the ad platform is down');

      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      provider.failAlways = null;
      const summary = await purchases.dispatchDue(minutesFromNow(8 * 24 * 60));

      expect(summary.expired).toBe(1);
      expect(summary.sent).toBe(0);
      expect(provider.purchases).toHaveLength(0);
      // Recorded, not swept: a queue that stopped draining should say so rather
      // than merely be empty.
      expect((await readDispatch(orderId))?.state).toBe('expired');
    });
  });

  // ─── Refunds ────────────────────────────────────────────────────────────────

  describe('a refunded order', () => {
    it('is not retracted', async () => {
      // The platform has no retraction for a web conversion, so there is no call
      // to make and the ones that could be made record a second purchase. The
      // platform's own count drifts above ours; ours already excludes the refund.
      await connectMeta();
      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      await admin.client
        .patch(`/orders/${orderId}/status`, { status: 'refunded' })
        .expect(200);
      await settle();
      await purchases.dispatchDue(minutesFromNow(CLAIM_LEASE_MINUTES + 5));

      expect(provider.purchases).toHaveLength(1);
      expect((await readDispatch(orderId))?.state).toBe('sent');
    });

    it('is still reported when the refund lands before the purchase was sent', async () => {
      // The sale happened, and the browser's copy of it has already arrived.
      // Withholding the server's copy now would leave the platform holding half
      // a purchase rather than none.
      await connectMeta();
      provider.failAlways = new Error('the ad platform is down');

      const { orderId } = await buy();
      await markPaid(orderId);
      await settledDispatch(orderId);

      await admin.client
        .patch(`/orders/${orderId}/status`, { status: 'refunded' })
        .expect(200);
      provider.failAlways = null;

      await purchases.dispatchDue(minutesFromNow(CLAIM_LEASE_MINUTES + 5));

      expect(provider.purchases).toHaveLength(1);
      expect(provider.purchases[0].event.eventId).toBe(orderId);
    });
  });
});
