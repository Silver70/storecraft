import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import {
  orderLineItems,
  orders,
  productVariants,
} from '../../../shared/database/schema';
import type { AttributableOrder } from '../utils/attributed-revenue.util';

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

/** The Orders one Store realized in a period. */
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

/** The columns every attributable read selects, one row per Order. */
const ATTRIBUTABLE_COLUMNS = {
  id: orders.id,
  total: orders.total,
  placedAt: orders.createdAt,
  firstUtmCampaign: orders.firstTouchUtmCampaign,
  firstUtmContent: orders.firstTouchUtmContent,
  firstAt: orders.firstTouchAt,
  lastUtmCampaign: orders.lastTouchUtmCampaign,
  lastUtmContent: orders.lastTouchUtmContent,
  lastAt: orders.lastTouchAt,
  isBot: IS_BOT,
};

interface AttributableRow {
  id: string;
  total: number;
  placedAt: Date;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstAt: Date | null;
  lastUtmCampaign: string | null;
  lastUtmContent: string | null;
  lastAt: Date | null;
  isBot: boolean | null;
}

function toAttributable(row: AttributableRow): IdentifiedOrder {
  return {
    id: row.id,
    total: row.total,
    placedAt: row.placedAt,
    isBot: row.isBot === true,
    firstTouch: {
      utmCampaign: row.firstUtmCampaign,
      utmContent: row.firstUtmContent,
      at: row.firstAt,
    },
    lastTouch: {
      utmCampaign: row.lastUtmCampaign,
      utmContent: row.lastUtmContent,
      at: row.lastAt,
    },
  };
}

/** An attributable Order that can be found again — for its line items. */
export interface IdentifiedOrder extends AttributableOrder {
  id: string;
}

/**
 * What the goods on a set of Orders cost, at the cost prices on file now.
 *
 * Cost price lives on the variant, not on the line item, so this is today's
 * cost of what was sold — the same reading the analytics profit report makes.
 */
export interface GoodsCostReading {
  /** Cost price × quantity over every item that has one, in minor units. */
  cost: number;
  /** Items whose variant has no cost price, or no longer exists. */
  uncostedItems: number;
  /**
   * The products those items belong to, once each, so a reader can send the
   * merchant straight to the missing prices. `productId` is null where the
   * variant has been deleted and there is nothing left to price.
   */
  uncostedProducts: { productId: string | null; name: string }[];
}

/**
 * Reads the Orders a period's attributed-revenue report is computed from.
 *
 * Deliberately no aggregation in SQL. Which Campaign an Order is credited to is
 * the latest-ad-click rule, and that rule is written once, in
 * `attributed-revenue.util`, where it is exercised without a database. The rows
 * come back raw — one per Order, both Touches on it — and the decision happens
 * there.
 */
@Injectable()
export class AttributionRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findAttributableOrders(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<IdentifiedOrder[]> {
    const rows = await this.db
      .select(ATTRIBUTABLE_COLUMNS)
      .from(orders)
      .where(attributableOrders(orgId, storeId, start, end));
    return rows.map(toAttributable);
  }

  /**
   * The period's Orders that could be credited to one Campaign: those whose
   * First or Last Touch carries its platform id.
   *
   * A narrowing, not a decision. An Order credited to a Campaign must name it
   * on one of its two Touches, so nothing that could be this Campaign's is
   * left out — but naming it is not enough (the other Touch may win, or be out
   * of the window), so the rows still go through the credit rule with the
   * whole Store's index.
   */
  async findOrdersNamingCampaign(
    orgId: string,
    storeId: string,
    externalCampaignId: string,
    start: Date,
    end: Date,
  ): Promise<IdentifiedOrder[]> {
    const rows = await this.db
      .select(ATTRIBUTABLE_COLUMNS)
      .from(orders)
      .where(
        and(
          attributableOrders(orgId, storeId, start, end),
          or(
            eq(orders.lastTouchUtmCampaign, externalCampaignId),
            eq(orders.firstTouchUtmCampaign, externalCampaignId),
          ),
        ),
      );
    return rows.map(toAttributable);
  }

  async goodsCost(
    orgId: string,
    storeId: string,
    orderIds: readonly string[],
  ): Promise<GoodsCostReading> {
    if (orderIds.length === 0) {
      return { cost: 0, uncostedItems: 0, uncostedProducts: [] };
    }

    const rows = await this.db
      .select({
        quantity: orderLineItems.quantity,
        productName: orderLineItems.productName,
        costPrice: productVariants.costPrice,
        productId: productVariants.productId,
      })
      .from(orderLineItems)
      .leftJoin(
        productVariants,
        and(
          eq(productVariants.id, orderLineItems.variantId),
          eq(productVariants.organizationId, orderLineItems.organizationId),
        ),
      )
      .where(
        and(
          eq(orderLineItems.organizationId, orgId),
          eq(orderLineItems.storeId, storeId),
          inArray(orderLineItems.orderId, [...orderIds]),
        ),
      );

    let cost = 0;
    let uncostedItems = 0;
    const uncosted = new Map<
      string,
      { productId: string | null; name: string }
    >();
    for (const row of rows) {
      if (row.costPrice === null) {
        uncostedItems += 1;
        const key = row.productId ?? `deleted:${row.productName}`;
        if (!uncosted.has(key)) {
          uncosted.set(key, {
            productId: row.productId,
            name: row.productName,
          });
        }
        continue;
      }
      cost += row.costPrice * row.quantity;
    }

    return {
      cost,
      uncostedItems,
      uncostedProducts: [...uncosted.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    };
  }
}
