import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import { orders } from '../../../shared/database/schema';
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
  ): Promise<AttributableOrder[]> {
    const rows = await this.db
      .select({
        total: orders.total,
        placedAt: orders.createdAt,
        firstUtmCampaign: orders.firstTouchUtmCampaign,
        firstUtmContent: orders.firstTouchUtmContent,
        firstAt: orders.firstTouchAt,
        lastUtmCampaign: orders.lastTouchUtmCampaign,
        lastUtmContent: orders.lastTouchUtmContent,
        lastAt: orders.lastTouchAt,
        isBot: IS_BOT,
      })
      .from(orders)
      .where(attributableOrders(orgId, storeId, start, end));

    return rows.map((row) => ({
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
    }));
  }
}
