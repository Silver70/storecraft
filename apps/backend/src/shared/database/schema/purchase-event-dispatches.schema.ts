import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { orders } from './orders.schema';

/**
 * Where one Order's Purchase Event has got to.
 *
 * - `pending`  — owed to the platform. Either never attempted or attempted and
 *                failed; the attempt count and the last error say which.
 * - `sent`     — the platform accepted it. Terminal, and the reason a
 *                successful dispatch is never sent twice.
 * - `withheld` — deliberately not sent, because the Store asks for consent and
 *                this visitor did not give it. Terminal: an answer given after
 *                the sale is not retroactive permission.
 * - `expired`  — still owed when the platform stopped being able to attribute
 *                it. Terminal, and recorded rather than swept, so a queue that
 *                stopped draining is legible instead of merely empty.
 *
 * There is no `sending`: the claim is the attempt, written in the same statement
 * that takes the row (see `PurchaseEventDispatchRepository.claim`), so a crash
 * mid-flight leaves a `pending` row with one more attempt against it rather
 * than a state nothing will ever move out of.
 */
export const purchaseDispatchStateEnum = pgEnum('purchase_dispatch_state', [
  'pending',
  'sent',
  'withheld',
  'expired',
]);

export type PurchaseDispatchState =
  (typeof purchaseDispatchStateEnum.enumValues)[number];

export const PURCHASE_DISPATCH_LIMITS = {
  /** Wide enough for a sentence an engineer reads in a log or a row. */
  lastError: 500,
} as const;

/**
 * One paid Order's Purchase Event, and how reporting it went.
 *
 * The platform learns who *buys* from here, not who clicks: every paid Order is
 * reported from our own server, whether or not we credited it to a Campaign,
 * because the platform runs its own attribution and a partial picture teaches it
 * the wrong lesson. The storefront's Pixel reports the same purchase from the
 * browser; both carry the Order's id as the event id, so the platform counts one
 * purchase and the server's copy is the one that survives an ad blocker.
 *
 * ## Why this is a table and not a log line
 *
 * Sending must never be able to fail a checkout — the same guarantee attribution
 * already has (ADR-0001). So the send cannot happen inside the transaction that
 * takes the money, which means it can be in flight, or owed, or refused, at a
 * moment nobody is watching. A row is what lets a failure be retried by the
 * scheduled job instead of being lost, and what lets a success be *known*, so
 * the retry does not report a second purchase.
 *
 * ## Keyed by the Order alone
 *
 * One row per Order, not one per Order per platform. A Store reports to the
 * Pixel on the ad account it connected and there is exactly one of those
 * (ADR-0006, Meta only). A `platform` column here would be a key with one
 * possible value, standing in for a second destination nobody has designed; a
 * second platform is a migration, deliberately.
 *
 * ## What is not here
 *
 * No copy of what was sent. The Order already holds all of it — total, currency,
 * the frozen browser identifiers, the consent answer — and a second copy of a
 * customer's contact details, kept only to explain a send that already happened,
 * is personal data held for the convenience of a debugger.
 */
export const purchaseEventDispatches = pgTable(
  'purchase_event_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    state: purchaseDispatchStateEnum('state').notNull().default('pending'),
    /**
     * How many times a send has been started for this Order, counted at the
     * moment the row is claimed rather than when a call returns — an attempt
     * that never came back is still an attempt, and the count is the only thing
     * that would say so.
     */
    attemptCount: integer('attempt_count').notNull().default(0),
    /**
     * When the last attempt started. Doubles as the lease: a row attempted
     * moments ago is not claimed again, which is what stops the scheduled job
     * and the just-paid Order from both reporting the same purchase.
     */
    lastAttemptAt: timestamp('last_attempt_at'),
    /**
     * Why the last attempt failed, or null after one succeeded.
     *
     * Written for an engineer, not a merchant: nothing on these screens surfaces
     * it, because a shopper's purchase being slow to reach an ad platform is not
     * a thing a merchant can act on. Never carries a response body — those
     * requests hold a credential and a customer's contact details.
     */
    lastError: varchar('last_error', {
      length: PURCHASE_DISPATCH_LIMITS.lastError,
    }),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The whole of "a successful one is never sent twice". Two racing writers
    // contend on this index rather than on a read that preceded them.
    unique('purchase_event_dispatches_order_unique').on(t.orderId),
    // The scheduled job's only query: what is still owed, oldest first.
    index('purchase_event_dispatches_state_attempt_idx').on(
      t.state,
      t.lastAttemptAt,
    ),
  ],
);

export type PurchaseEventDispatch = typeof purchaseEventDispatches.$inferSelect;
export type NewPurchaseEventDispatch =
  typeof purchaseEventDispatches.$inferInsert;
