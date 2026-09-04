import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import {
  orderLineItems,
  orders,
  productVariants,
} from '../../../shared/database/schema';
import type { CostedOrder } from '../utils/attributed-revenue.util';
import type { PreviewableOrder } from '../utils/rule-preview.util';

/** Which Touch a report credits: the ad that discovered the visitor, or the one that closed them. */
export type AttributionTouch = 'first' | 'last';

/**
 * The Order statuses that count as realized revenue — the same four the
 * dashboard and the analytics sales reports count, stated here so attributed
 * revenue reconciles with them for the same period. Changing this set without
 * changing theirs would make the two reports disagree, which is worse than
 * either being wrong.
 */
const REVENUE_STATUSES = [
  'paid',
  'processing',
  'shipped',
  'delivered',
] as const;

/**
 * Whether the event log ever classified this Order's visitor as a bot.
 *
 * Orders carry no device classification of their own — the bot signal lives on
 * `analytics_events`, where every other query already excludes it — so the
 * visitor is looked up by the session or visitor id the Order froze. Matching
 * on either is deliberate: a session id is the tighter join, but a visitor
 * flagged as a bot on any session is not one we want crediting an ad.
 *
 * A bot Order is not removed from the read: its revenue is still revenue and
 * still has to reconcile. It is denied a *Campaign*, and lands in Unattributed.
 */
const IS_BOT = sql<boolean>`EXISTS (
  SELECT 1
  FROM analytics_events e
  WHERE e.organization_id = ${orders.organizationId}
    AND e.store_id = ${orders.storeId}
    AND e.device_type = 'bot'
    AND (
      (${orders.sessionId} IS NOT NULL AND e.session_id = ${orders.sessionId})
      OR (${orders.visitorId} IS NOT NULL AND e.visitor_id = ${orders.visitorId})
    )
)`;

/** The Touch column group the selected mode reads, as stored on the Order. */
function touchColumns(touch: AttributionTouch) {
  return touch === 'first'
    ? {
        utmSource: orders.firstTouchUtmSource,
        utmMedium: orders.firstTouchUtmMedium,
        utmCampaign: orders.firstTouchUtmCampaign,
        referrer: orders.firstTouchReferrer,
        touchedAt: orders.firstTouchAt,
      }
    : {
        utmSource: orders.lastTouchUtmSource,
        utmMedium: orders.lastTouchUtmMedium,
        utmCampaign: orders.lastTouchUtmCampaign,
        referrer: orders.lastTouchReferrer,
        touchedAt: orders.lastTouchAt,
      };
}

/**
 * The Orders one Store realized in a period. Both reads below share it, so a
 * rule preview and the report it predicts are computed from the same rows —
 * which is what makes saving the previewed rule produce the figures shown.
 */
function attributableOrders(
  orgId: string,
  storeId: string,
  start: Date,
  end: Date,
) {
  return and(
    eq(orders.organizationId, orgId),
    eq(orders.storeId, storeId),
    inArray(orders.status, [...REVENUE_STATUSES]),
    gte(orders.createdAt, start),
    lt(orders.createdAt, end),
  );
}

/**
 * The goods basis of one Order, as three sums over its line items.
 *
 * `cost_price` is nullable, and the `CASE` is the whole point of these columns
 * rather than an edge case in them: a line whose variant has no cost price
 * contributes to neither `cost` nor `revenue_with_cost`, so an uncosted catalog
 * produces no cost and no coverage instead of a zero cost that would read as
 * free goods. This is the same shape the analytics profit report computes, for
 * the same reason — the two must not come to mean different things by
 * "coverage".
 *
 * `::int` because Postgres sums integers as `bigint`, which reaches the driver
 * as a string; these are per-Order sums in minor units, so the cast is exact.
 */
const GOODS_REVENUE = sql<number>`coalesce(sum(${orderLineItems.totalPrice}), 0)::int`;

const GOODS_COST = sql<number>`coalesce(sum(
  CASE WHEN ${productVariants.costPrice} IS NOT NULL
       THEN ${productVariants.costPrice} * ${orderLineItems.quantity} END
), 0)::int`;

const REVENUE_WITH_COST = sql<number>`coalesce(sum(
  CASE WHEN ${productVariants.costPrice} IS NOT NULL
       THEN ${orderLineItems.totalPrice} END
), 0)::int`;

/**
 * Reads the Orders a period's attributed-revenue report is computed from.
 *
 * Deliberately no aggregation *of the report* in SQL. Resolving an Order to a
 * Campaign means running the matching rules, which normalize both sides of
 * every comparison — expressible in SQL, but only as something no one could
 * read or unit test. The rows come back raw and the decision happens in
 * `attributed-revenue.util`, where it is exercised without a database.
 *
 * The line items *are* summed in SQL, per Order and no further. That is not the
 * report's aggregation: which Campaign an Order belongs to is still decided in
 * TypeScript afterwards, and what the query settles is only what the Order
 * itself is worth on the goods basis — a fact about the Order, the same for
 * every Campaign that might claim it. Loading each line item to add three
 * columns up in JavaScript would multiply the rows read by the size of the
 * average basket for an identical answer.
 */
@Injectable()
export class AttributionRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findAttributableOrders(
    orgId: string,
    storeId: string,
    touch: AttributionTouch,
    start: Date,
    end: Date,
  ): Promise<CostedOrder[]> {
    const columns = touchColumns(touch);

    const rows = await this.db
      .select({
        total: orders.total,
        placedAt: orders.createdAt,
        // The discount is the Order's own, not a sum over the join: it is one
        // figure per Order already, and summing it across line items would
        // multiply it by the basket size.
        discount: orders.discountAmount,
        utmSource: columns.utmSource,
        utmMedium: columns.utmMedium,
        utmCampaign: columns.utmCampaign,
        referrer: columns.referrer,
        touchedAt: columns.touchedAt,
        isBot: IS_BOT,
        goodsRevenue: GOODS_REVENUE,
        cost: GOODS_COST,
        revenueWithCost: REVENUE_WITH_COST,
      })
      .from(orders)
      // A left join throughout: an Order with no line items, or a line item
      // whose variant has since been deleted, still has a total and still has
      // to reconcile with the sales reports. It contributes no goods and no
      // cost, which is exactly what a null cost price means anyway.
      .leftJoin(
        orderLineItems,
        and(
          eq(orderLineItems.orderId, orders.id),
          eq(orderLineItems.organizationId, orders.organizationId),
        ),
      )
      .leftJoin(
        productVariants,
        and(
          eq(productVariants.id, orderLineItems.variantId),
          eq(productVariants.organizationId, orderLineItems.organizationId),
        ),
      )
      .where(attributableOrders(orgId, storeId, start, end))
      // The Order's primary key, so every other `orders` column above is
      // functionally dependent on the group and the sums are per Order.
      .groupBy(orders.id);

    return rows.map((row) => ({
      total: row.total,
      placedAt: row.placedAt,
      isBot: row.isBot === true,
      goodsRevenue: row.goodsRevenue,
      cost: row.cost,
      revenueWithCost: row.revenueWithCost,
      discount: row.discount,
      touch: {
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
        referrer: row.referrer,
        at: row.touchedAt,
      },
    }));
  }

  /**
   * The same Orders, carrying the identity a preview needs to name a few of
   * them on screen.
   *
   * A separate read rather than two extra columns on the one above: the report
   * resolves a period into buckets and has no use for an order number, and the
   * type it hands the tally is deliberately reduced to what deciding a credit
   * needs. It runs the other way too — a preview answers which Campaign wins an
   * Order, never what the Order cost, so it does not join the line items or the
   * catalog to compute a goods basis nothing here reads. Newest first, so the
   * Orders a preview names are the ones the merchant most likely recognises.
   */
  async findPreviewableOrders(
    orgId: string,
    storeId: string,
    touch: AttributionTouch,
    start: Date,
    end: Date,
  ): Promise<PreviewableOrder[]> {
    const columns = touchColumns(touch);

    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.total,
        placedAt: orders.createdAt,
        utmSource: columns.utmSource,
        utmMedium: columns.utmMedium,
        utmCampaign: columns.utmCampaign,
        referrer: columns.referrer,
        touchedAt: columns.touchedAt,
        isBot: IS_BOT,
      })
      .from(orders)
      .where(attributableOrders(orgId, storeId, start, end))
      .orderBy(desc(orders.createdAt));

    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      total: row.total,
      placedAt: row.placedAt,
      isBot: row.isBot === true,
      touch: {
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
        referrer: row.referrer,
        at: row.touchedAt,
      },
    }));
  }
}
