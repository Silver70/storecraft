import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import {
  adPlatformConnections,
  orders,
  purchaseEventDispatches,
  stores,
} from '../../../shared/database/schema';
import type {
  AdPlatformConnection,
  Order,
  PurchaseEventDispatch,
} from '../../../shared/database/schema';
import { PURCHASE_DISPATCH_LIMITS } from '../../../shared/database/schema';
import {
  PURCHASED_ORDER_STATUSES,
  attributionWindowStart,
  claimableBefore,
} from '../utils/purchase-dispatch.util';

/**
 * One paid Order that owes the ad platform a Purchase Event, with everything the
 * send needs beside it.
 *
 * Assembled in one query rather than fetched per Order, because the job's
 * ordinary case is a handful of Orders across several Organizations and the
 * alternative is four round trips each. The Store's two settings travel along
 * for the same reason the timezone travels with a connection to sync: they decide
 * whether the send may happen at all and where it says it happened.
 */
export interface PurchaseDispatchTarget {
  order: Order;
  /** Whether this Store asks visitors before measuring anything. */
  consentRequired: boolean;
  /** The Store's storefront, where the merchant has told us one. */
  storefrontUrl: string | null;
  connection: AdPlatformConnection;
  /** The dispatch already on record, or null where this Order has never had one. */
  dispatch: PurchaseEventDispatch | null;
}

/**
 * The dispatch ledger: what has been reported to the ad platform, what is still
 * owed, and what was deliberately withheld.
 *
 * ## Why the reads here are cross-tenant
 *
 * The scheduled job has no request and therefore no Organization, exactly as the
 * sync and the analytics rollup have none. Every row it touches carries its own
 * `organization_id` and its own `store_id`, taken from the Order, so the tenancy
 * guarantee is kept by the rows rather than by the query that found them — and
 * the one read a request can reach (`findTargetForOrder`) filters on both.
 *
 * ## Why claiming is one statement
 *
 * Two writers can want the same Order at the same moment: the Order has just been
 * paid, and the job is running. `claim` is the arbitration, and it is a single
 * `INSERT … ON CONFLICT DO UPDATE … WHERE` so that the arbitration happens in the
 * database rather than between a read and a write. Whoever gets a row back owns
 * the send; whoever gets nothing back does nothing. That is the whole of "a
 * successful one is never sent twice, including when the job runs repeatedly".
 */
@Injectable()
export class PurchaseEventDispatchRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * Every Order across every tenant that owes a Purchase Event now.
   *
   * Includes Orders with no dispatch row at all, which is what makes the queue
   * self-healing: the listener that fires when an Order is paid is a latency
   * optimisation, not the record. If the process dies between the payment and the
   * row, the next run of the job finds the Order and reports it anyway — the
   * alternative is a sale the platform never hears about because of a restart.
   *
   * Three joins do the filtering that would otherwise be branches in the service:
   * a Store that still exists, a connection that is still connected and has a
   * Pixel — so **a Store with no connection dispatches nothing and queues
   * nothing** — and a dispatch that is either absent or pending and out of lease.
   */
  async findDue(now: Date, limit = 200): Promise<PurchaseDispatchTarget[]> {
    const claimable = claimableBefore(now);

    return (
      this.db
        .select({
          order: orders,
          consentRequired: stores.requiresMeasurementConsent,
          storefrontUrl: stores.storefrontUrl,
          connection: adPlatformConnections,
          dispatch: purchaseEventDispatches,
        })
        .from(orders)
        .innerJoin(stores, eq(stores.id, orders.storeId))
        .innerJoin(
          adPlatformConnections,
          and(
            eq(adPlatformConnections.storeId, orders.storeId),
            eq(adPlatformConnections.status, 'connected'),
          ),
        )
        .leftJoin(
          purchaseEventDispatches,
          eq(purchaseEventDispatches.orderId, orders.id),
        )
        .where(
          and(
            inArray(orders.status, [...PURCHASED_ORDER_STATUSES]),
            // Past the platform's attribution window there is nothing to gain and
            // a customer's contact details to spend gaining it.
            gte(orders.createdAt, attributionWindowStart(now)),
            isNull(stores.deletedAt),
            isNotNull(adPlatformConnections.pixelId),
            or(
              isNull(purchaseEventDispatches.id),
              and(
                eq(purchaseEventDispatches.state, 'pending'),
                or(
                  isNull(purchaseEventDispatches.lastAttemptAt),
                  lte(purchaseEventDispatches.lastAttemptAt, claimable),
                ),
              ),
            ),
          ),
        )
        // Oldest purchase first: it is the one closest to losing its attribution.
        .orderBy(asc(orders.createdAt))
        .limit(limit)
    );
  }

  /**
   * One Order's dispatch target, for the send that follows the payment itself.
   *
   * Scoped to the Organization and the Store, because unlike the job this is
   * reached from a request. It answers null for an Order on a Store with no
   * connection — the same silence `findDue` gives, from the same joins.
   */
  async findTargetForOrder(
    orgId: string,
    storeId: string,
    orderId: string,
  ): Promise<PurchaseDispatchTarget | null> {
    const [row] = await this.db
      .select({
        order: orders,
        consentRequired: stores.requiresMeasurementConsent,
        storefrontUrl: stores.storefrontUrl,
        connection: adPlatformConnections,
        dispatch: purchaseEventDispatches,
      })
      .from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId))
      .innerJoin(
        adPlatformConnections,
        and(
          eq(adPlatformConnections.storeId, orders.storeId),
          eq(adPlatformConnections.status, 'connected'),
        ),
      )
      .leftJoin(
        purchaseEventDispatches,
        eq(purchaseEventDispatches.orderId, orders.id),
      )
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, orgId),
          eq(orders.storeId, storeId),
          inArray(orders.status, [...PURCHASED_ORDER_STATUSES]),
          isNotNull(adPlatformConnections.pixelId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Takes ownership of one Order's send, or answers null because somebody else
   * has it.
   *
   * The attempt is counted here and not when the call returns. An attempt that
   * never came back — a killed process, a request that hung past its timeout — is
   * still an attempt, and the count is the only thing that would ever say so.
   *
   * Null means one of three things and the caller need not tell them apart: the
   * purchase is already reported, it was withheld or has expired, or another
   * writer claimed it moments ago and may still be in flight.
   */
  async claim(
    target: PurchaseDispatchTarget,
    now: Date,
  ): Promise<PurchaseEventDispatch | null> {
    const [row] = await this.db
      .insert(purchaseEventDispatches)
      .values({
        organizationId: target.order.organizationId,
        storeId: target.order.storeId,
        orderId: target.order.id,
        state: 'pending',
        attemptCount: 1,
        lastAttemptAt: now,
      })
      .onConflictDoUpdate({
        target: purchaseEventDispatches.orderId,
        set: {
          attemptCount: sql`${purchaseEventDispatches.attemptCount} + 1`,
          lastAttemptAt: now,
          updatedAt: now,
        },
        // The existing row, not the one being inserted: only a dispatch that is
        // still owed and out of its lease may be taken over.
        setWhere: and(
          eq(purchaseEventDispatches.state, 'pending'),
          or(
            isNull(purchaseEventDispatches.lastAttemptAt),
            lte(purchaseEventDispatches.lastAttemptAt, claimableBefore(now)),
          ),
        ),
      })
      .returning();
    return row ?? null;
  }

  /** The platform accepted it. Terminal: nothing reads this row again. */
  async markSent(dispatchId: string, at: Date): Promise<void> {
    await this.db
      .update(purchaseEventDispatches)
      .set({ state: 'sent', sentAt: at, lastError: null, updatedAt: at })
      .where(eq(purchaseEventDispatches.id, dispatchId));
  }

  /**
   * The platform refused it. The row stays `pending`, which is what makes the
   * next run of the job retry it, and keeps the reason for whoever asks why a
   * queue is not draining.
   */
  async recordFailure(
    dispatchId: string,
    message: string,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(purchaseEventDispatches)
      .set({
        lastError: message.slice(0, PURCHASE_DISPATCH_LIMITS.lastError),
        updatedAt: at,
      })
      .where(eq(purchaseEventDispatches.id, dispatchId));
  }

  /**
   * Records that this Order's purchase will not be reported, because the visitor
   * did not agree to be measured.
   *
   * Written rather than simply skipped, so that "nothing was sent" is a decision
   * on the record instead of an absence, and so the job stops reconsidering an
   * Order whose answer cannot change. It never overwrites a dispatch that was
   * already sent: a Store that turns the consent switch on today has not
   * un-reported last week's sales.
   */
  async recordWithheld(
    target: PurchaseDispatchTarget,
    at: Date,
  ): Promise<void> {
    await this.db
      .insert(purchaseEventDispatches)
      .values({
        organizationId: target.order.organizationId,
        storeId: target.order.storeId,
        orderId: target.order.id,
        state: 'withheld',
      })
      .onConflictDoUpdate({
        target: purchaseEventDispatches.orderId,
        set: { state: 'withheld', updatedAt: at },
        setWhere: eq(purchaseEventDispatches.state, 'pending'),
      });
  }

  /**
   * Closes off dispatches the platform can no longer attribute.
   *
   * A queue that stopped draining should say so. Left alone, a permanently
   * failing Order would be retried every hour forever and a merchant's ledger
   * would carry a `pending` row from three months ago that nothing will ever
   * resolve; swept silently, the same row would simply vanish. `expired` is the
   * third option, and the only one that can be read afterwards.
   *
   * Dated from the Order rather than from the dispatch row, because a row the job
   * created six days after the purchase inherits six days of the window, not a
   * fresh seven.
   */
  async expireStale(now: Date): Promise<number> {
    const stale = this.db
      .select({ id: orders.id })
      .from(orders)
      .where(lt(orders.createdAt, attributionWindowStart(now)));

    const rows = await this.db
      .update(purchaseEventDispatches)
      .set({ state: 'expired', updatedAt: now })
      .where(
        and(
          eq(purchaseEventDispatches.state, 'pending'),
          inArray(purchaseEventDispatches.orderId, stale),
        ),
      )
      .returning({ id: purchaseEventDispatches.id });

    return rows.length;
  }

  /** One Order's dispatch row, for the admin read and for a test. */
  async findByOrder(
    orgId: string,
    orderId: string,
  ): Promise<PurchaseEventDispatch | null> {
    const [row] = await this.db
      .select()
      .from(purchaseEventDispatches)
      .where(
        and(
          eq(purchaseEventDispatches.organizationId, orgId),
          eq(purchaseEventDispatches.orderId, orderId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
