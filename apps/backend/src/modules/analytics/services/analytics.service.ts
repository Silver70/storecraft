import { Injectable, Inject } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { pct } from '../../../shared/utils/percent.util';

/**
 * Time window for analytics aggregation. Owned by this module so analytics
 * stays independent of the dashboard module (which has its own AnalyticsPeriod).
 */
export type AnalyticsPeriod = 'today' | '7d' | '30d' | '90d';

// Statuses that count as realized revenue — mirrors DashboardService. Composed
// as an inline SQL fragment (not a bound array) so it coerces cleanly against
// the `order_status` enum column, exactly as DashboardService does.
const REVENUE_STATUS_IN = sql`in ('paid', 'processing', 'shipped', 'delivered')`;

// Human traffic only — exclude server-flagged bots from all event analytics.
// NULL device_type (Phase 2 events, ingested before device enrichment) counts
// as human so historical numbers don't collapse.
const NOT_BOT = sql`(device_type IS NULL OR device_type <> 'bot')`;

function periodDays(period: AnalyticsPeriod): number {
  if (period === 'today') return 1;
  if (period === '7d') return 7;
  if (period === '30d') return 30;
  return 90;
}

/** [start, now) window for the selected period. */
function getRange(period: AnalyticsPeriod): { start: Date; end: Date } {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start, end: now };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - periodDays(period));
  return { start, end: now };
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface SalesAnalytics {
  period: AnalyticsPeriod;
  topProducts: { productName: string; quantity: number; revenue: number }[];
  salesByCategory: {
    categoryName: string;
    quantity: number;
    revenue: number;
  }[];
  profit: {
    revenue: number;
    cost: number;
    grossProfit: number;
    marginPct: number;
    /** Share of revenue whose line items have a known cost price. */
    coveragePct: number;
  };
  discounts: {
    couponCode: string;
    orders: number;
    discountTotal: number;
    revenue: number;
  }[];
}

export interface OrdersAnalytics {
  period: AnalyticsPeriod;
  statusBreakdown: { status: string; count: number; revenue: number }[];
  cartAbandonment: {
    convertedCount: number;
    abandonedCount: number;
    abandonmentRatePct: number;
    lostValue: number;
  };
  refunds: { count: number; amount: number; refundRatePct: number };
  payments: {
    captured: number;
    failed: number;
    pending: number;
    successRatePct: number;
  };
}

export interface CustomersAnalytics {
  period: AnalyticsPeriod;
  totalCustomers: number;
  newInPeriod: number;
  growth: { date: string; count: number }[];
  newVsReturning: { newCustomers: number; returning: number };
}

export interface InventoryAnalytics {
  lowStockCount: number;
  outOfStockCount: number;
  inStockCount: number;
  stockUnits: number;
  stockValueAtCost: number;
  lowStock: {
    productName: string;
    variantName: string | null;
    sku: string;
    available: number;
    threshold: number;
  }[];
}

export interface TrafficAnalytics {
  period: AnalyticsPeriod;
  uniqueVisitors: number;
  orders: number;
  /** orders ÷ unique visitors, as a percentage with one decimal. */
  trueConversionRatePct: number;
  sources: { channel: string; sessions: number }[];
  topReferrers: { referrer: string; sessions: number }[];
  funnel: { stage: string; sessions: number }[];
}

export interface AudienceAnalytics {
  period: AnalyticsPeriod;
  totalSessions: number;
  devices: { label: string; sessions: number }[];
  browsers: { label: string; sessions: number }[];
  operatingSystems: { label: string; sessions: number }[];
  countries: { countryCode: string; sessions: number }[];
}

export interface BehaviorAnalytics {
  period: AnalyticsPeriod;
  topPages: { path: string; views: number; visitors: number }[];
  entryPages: { path: string; sessions: number }[];
  topClicks: { label: string; count: number }[];
  forms: { name: string; submissions: number }[];
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  // ─── Traffic & funnel (Phase 2 — analytics_events) ──────────────────────────

  async getTraffic(
    orgId: string,
    storeId: string,
    period: AnalyticsPeriod,
  ): Promise<TrafficAnalytics> {
    const { start, end } = getRange(period);
    const [funnel, sources, orders, topReferrers] = await Promise.all([
      this.funnelCounts(orgId, storeId, start, end),
      this.trafficSources(orgId, storeId, start, end),
      this.ordersInPeriod(orgId, storeId, start, end),
      this.trafficReferrers(orgId, storeId, start, end),
    ]);

    const uniqueVisitors = funnel.visitors;
    const trueConversionRatePct =
      uniqueVisitors > 0
        ? Math.round((orders / uniqueVisitors) * 1000) / 10
        : 0;

    return {
      period,
      uniqueVisitors,
      orders,
      trueConversionRatePct,
      sources,
      topReferrers,
      funnel: [
        { stage: 'Visitors', sessions: funnel.visitors },
        { stage: 'Product views', sessions: funnel.productViews },
        { stage: 'Add to cart', sessions: funnel.addToCart },
        { stage: 'Checkout', sessions: funnel.checkout },
        { stage: 'Purchase', sessions: funnel.purchase },
      ],
    };
  }

  private async funnelCounts(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<{
    visitors: number;
    productViews: number;
    addToCart: number;
    checkout: number;
    purchase: number;
  }> {
    const res = await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT session_id)::bigint AS visitors,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'product_view')::bigint AS product_views,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'add_to_cart')::bigint AS add_to_cart,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'checkout_start')::bigint AS checkout,
        COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'purchase')::bigint AS purchase
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
    `);
    const r = res.rows[0] as {
      visitors: string;
      product_views: string;
      add_to_cart: string;
      checkout: string;
      purchase: string;
    };
    return {
      visitors: Number(r.visitors),
      productViews: Number(r.product_views),
      addToCart: Number(r.add_to_cart),
      checkout: Number(r.checkout),
      purchase: Number(r.purchase),
    };
  }

  private async trafficSources(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<TrafficAnalytics['sources']> {
    // Attribute each session to the channel of its FIRST event (first-touch),
    // then group. Channel is derived from utm_medium/source and the referrer
    // host — no attribution is stored server-side, callers just send raw values.
    const res = await this.db.execute(sql`
      WITH first_touch AS (
        SELECT DISTINCT ON (session_id)
          session_id, referrer, utm_source, utm_medium
        FROM analytics_events
        WHERE organization_id = ${orgId}
          AND store_id = ${storeId}
          AND occurred_at >= ${start.toISOString()}
          AND occurred_at < ${end.toISOString()}
          AND ${NOT_BOT}
        ORDER BY session_id, occurred_at ASC
      )
      SELECT
        CASE
          WHEN lower(coalesce(utm_medium, '')) IN ('cpc','ppc','paid','paid_social','paidsearch') THEN 'Paid'
          WHEN referrer ~* '(chatgpt\\.com|chat\\.openai\\.com|perplexity\\.ai|claude\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com|you\\.com|poe\\.com)'
            OR lower(coalesce(utm_source, '')) ~ '(chatgpt|openai|perplexity|gemini|copilot|claude)' THEN 'AI Assistant'
          WHEN coalesce(utm_source, '') <> '' THEN 'Campaign'
          WHEN coalesce(referrer, '') = '' THEN 'Direct'
          WHEN referrer ~* '(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex)\\.' THEN 'Organic Search'
          WHEN referrer ~* '(facebook|instagram|twitter|t\\.co|x\\.com|tiktok|linkedin|pinterest|youtube|reddit|snapchat)\\.' THEN 'Social'
          ELSE 'Referral'
        END AS channel,
        COUNT(*)::bigint AS sessions
      FROM first_touch
      GROUP BY 1
      ORDER BY sessions DESC
    `);
    return (res.rows as { channel: string; sessions: string }[]).map((r) => ({
      channel: r.channel,
      sessions: Number(r.sessions),
    }));
  }

  private async ordersInPeriod(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const res = await this.db.execute(sql`
      SELECT COUNT(*)::bigint AS count
      FROM orders
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND status ${REVENUE_STATUS_IN}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
    `);
    return Number((res.rows[0] as { count: string }).count);
  }

  private async trafficReferrers(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<TrafficAnalytics['topReferrers']> {
    // Group distinct sessions by referrer host (strip scheme + path).
    const res = await this.db.execute(sql`
      SELECT
        COALESCE(substring(referrer from '^https?://([^/]+)'), referrer) AS referrer,
        COUNT(DISTINCT session_id)::bigint AS sessions
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
        AND referrer IS NOT NULL
        AND referrer <> ''
      GROUP BY 1
      ORDER BY sessions DESC
      LIMIT 10
    `);
    return (res.rows as { referrer: string; sessions: string }[]).map((r) => ({
      referrer: r.referrer,
      sessions: Number(r.sessions),
    }));
  }

  // ─── Audience (device / browser / OS / geo — Phase 3) ───────────────────────

  async getAudience(
    orgId: string,
    storeId: string,
    period: AnalyticsPeriod,
  ): Promise<AudienceAnalytics> {
    const { start, end } = getRange(period);
    const [devices, browsers, operatingSystems, countryRows, totalSessions] =
      await Promise.all([
        this.groupSessions(
          orgId,
          storeId,
          start,
          end,
          sql`COALESCE(device_type, 'unknown')`,
        ),
        this.groupSessions(
          orgId,
          storeId,
          start,
          end,
          sql`browser`,
          sql`browser IS NOT NULL`,
        ),
        this.groupSessions(
          orgId,
          storeId,
          start,
          end,
          sql`os`,
          sql`os IS NOT NULL`,
        ),
        this.groupSessions(
          orgId,
          storeId,
          start,
          end,
          sql`country_code`,
          sql`country_code IS NOT NULL`,
        ),
        this.totalSessions(orgId, storeId, start, end),
      ]);
    return {
      period,
      totalSessions,
      devices,
      browsers,
      operatingSystems,
      countries: countryRows.map((r) => ({
        countryCode: r.label,
        sessions: r.sessions,
      })),
    };
  }

  // Distinct sessions grouped by a (trusted, non-user-supplied) column/expr.
  private async groupSessions(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
    expr: SQL,
    extra?: SQL,
  ): Promise<{ label: string; sessions: number }[]> {
    const res = await this.db.execute(sql`
      SELECT ${expr} AS label, COUNT(DISTINCT session_id)::bigint AS sessions
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
        ${extra ? sql`AND ${extra}` : sql``}
      GROUP BY 1
      ORDER BY sessions DESC
      LIMIT 12
    `);
    return (res.rows as { label: string | null; sessions: string }[])
      .filter((r) => r.label != null)
      .map((r) => ({ label: r.label as string, sessions: Number(r.sessions) }));
  }

  private async totalSessions(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const res = await this.db.execute(sql`
      SELECT COUNT(DISTINCT session_id)::bigint AS count
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
    `);
    return Number((res.rows[0] as { count: string }).count);
  }

  // ─── Behavior (pages / clicks / forms — Phase 3) ────────────────────────────

  async getBehavior(
    orgId: string,
    storeId: string,
    period: AnalyticsPeriod,
  ): Promise<BehaviorAnalytics> {
    const { start, end } = getRange(period);
    const [topPages, entryPages, topClicks, forms] = await Promise.all([
      this.topPages(orgId, storeId, start, end),
      this.entryPages(orgId, storeId, start, end),
      this.topClicks(orgId, storeId, start, end),
      this.formSubmissions(orgId, storeId, start, end),
    ]);
    return { period, topPages, entryPages, topClicks, forms };
  }

  private async topPages(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<BehaviorAnalytics['topPages']> {
    const res = await this.db.execute(sql`
      SELECT
        path,
        COUNT(*)::bigint AS views,
        COUNT(DISTINCT session_id)::bigint AS visitors
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
        AND event_type = 'page_view'
        AND path IS NOT NULL
      GROUP BY path
      ORDER BY views DESC
      LIMIT 10
    `);
    return (
      res.rows as { path: string; views: string; visitors: string }[]
    ).map((r) => ({
      path: r.path,
      views: Number(r.views),
      visitors: Number(r.visitors),
    }));
  }

  private async entryPages(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<BehaviorAnalytics['entryPages']> {
    // The first page_view of each session = the landing page.
    const res = await this.db.execute(sql`
      WITH first_pv AS (
        SELECT DISTINCT ON (session_id) session_id, path
        FROM analytics_events
        WHERE organization_id = ${orgId}
          AND store_id = ${storeId}
          AND occurred_at >= ${start.toISOString()}
          AND occurred_at < ${end.toISOString()}
          AND ${NOT_BOT}
          AND event_type = 'page_view'
          AND path IS NOT NULL
        ORDER BY session_id, occurred_at ASC
      )
      SELECT path, COUNT(*)::bigint AS sessions
      FROM first_pv
      GROUP BY path
      ORDER BY sessions DESC
      LIMIT 10
    `);
    return (res.rows as { path: string; sessions: string }[]).map((r) => ({
      path: r.path,
      sessions: Number(r.sessions),
    }));
  }

  private async topClicks(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<BehaviorAnalytics['topClicks']> {
    const res = await this.db.execute(sql`
      SELECT
        COALESCE(NULLIF(event_name, ''), properties->>'text', properties->>'tag', 'unknown') AS label,
        COUNT(*)::bigint AS count
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
        AND event_type = 'click'
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
    `);
    return (res.rows as { label: string; count: string }[]).map((r) => ({
      label: r.label,
      count: Number(r.count),
    }));
  }

  private async formSubmissions(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<BehaviorAnalytics['forms']> {
    const res = await this.db.execute(sql`
      SELECT
        COALESCE(NULLIF(event_name, ''), properties->>'name', properties->>'id', 'form') AS name,
        COUNT(*)::bigint AS submissions
      FROM analytics_events
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND occurred_at >= ${start.toISOString()}
        AND occurred_at < ${end.toISOString()}
        AND ${NOT_BOT}
        AND event_type = 'form_submit'
      GROUP BY 1
      ORDER BY submissions DESC
      LIMIT 10
    `);
    return (res.rows as { name: string; submissions: string }[]).map((r) => ({
      name: r.name,
      submissions: Number(r.submissions),
    }));
  }

  // ─── Sales ──────────────────────────────────────────────────────────────────

  async getSales(
    orgId: string,
    storeId: string,
    period: AnalyticsPeriod,
  ): Promise<SalesAnalytics> {
    const { start, end } = getRange(period);
    const [topProducts, salesByCategory, profit, discounts] = await Promise.all(
      [
        this.topProducts(orgId, storeId, start, end),
        this.salesByCategory(orgId, storeId, start, end),
        this.profit(orgId, storeId, start, end),
        this.discounts(orgId, storeId, start, end),
      ],
    );
    return { period, topProducts, salesByCategory, profit, discounts };
  }

  private async topProducts(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<SalesAnalytics['topProducts']> {
    const res = await this.db.execute(sql`
      SELECT
        li.product_name AS product_name,
        SUM(li.quantity)::bigint AS quantity,
        SUM(li.total_price)::bigint AS revenue
      FROM order_line_items li
      JOIN orders o ON o.id = li.order_id
      WHERE li.organization_id = ${orgId}
        AND li.store_id = ${storeId}
        AND o.status ${REVENUE_STATUS_IN}
        AND o.created_at >= ${start.toISOString()}
        AND o.created_at < ${end.toISOString()}
      GROUP BY li.product_name
      ORDER BY revenue DESC
      LIMIT 8
    `);
    return (
      res.rows as { product_name: string; quantity: string; revenue: string }[]
    ).map((r) => ({
      productName: r.product_name,
      quantity: Number(r.quantity),
      revenue: Number(r.revenue),
    }));
  }

  private async salesByCategory(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<SalesAnalytics['salesByCategory']> {
    // Joins to the LIVE variant→product→category graph (line items don't
    // snapshot a category). Lines with no variant, or a product in no category,
    // fall into "Uncategorized". A recategorized product reshapes history —
    // acceptable for analytics.
    const res = await this.db.execute(sql`
      SELECT
        COALESCE(c.name, 'Uncategorized') AS category_name,
        SUM(li.quantity)::bigint AS quantity,
        SUM(li.total_price)::bigint AS revenue
      FROM order_line_items li
      JOIN orders o ON o.id = li.order_id
      LEFT JOIN product_variants v ON v.id = li.variant_id
      LEFT JOIN product_categories pc ON pc.product_id = v.product_id
      LEFT JOIN categories c ON c.id = pc.category_id
      WHERE li.organization_id = ${orgId}
        AND li.store_id = ${storeId}
        AND o.status ${REVENUE_STATUS_IN}
        AND o.created_at >= ${start.toISOString()}
        AND o.created_at < ${end.toISOString()}
      GROUP BY COALESCE(c.name, 'Uncategorized')
      ORDER BY revenue DESC
      LIMIT 10
    `);
    return (
      res.rows as { category_name: string; quantity: string; revenue: string }[]
    ).map((r) => ({
      categoryName: r.category_name,
      quantity: Number(r.quantity),
      revenue: Number(r.revenue),
    }));
  }

  private async profit(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<SalesAnalytics['profit']> {
    // costPrice is nullable — only lines with a known cost contribute to `cost`,
    // and `coveragePct` reports how much of revenue that covers so the margin is
    // read with the right caveat.
    const res = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(li.total_price), 0)::bigint AS revenue,
        COALESCE(SUM(
          CASE WHEN v.cost_price IS NOT NULL
               THEN v.cost_price * li.quantity END
        ), 0)::bigint AS cost,
        COALESCE(SUM(
          CASE WHEN v.cost_price IS NOT NULL
               THEN li.total_price END
        ), 0)::bigint AS revenue_with_cost
      FROM order_line_items li
      JOIN orders o ON o.id = li.order_id
      LEFT JOIN product_variants v ON v.id = li.variant_id
      WHERE li.organization_id = ${orgId}
        AND li.store_id = ${storeId}
        AND o.status ${REVENUE_STATUS_IN}
        AND o.created_at >= ${start.toISOString()}
        AND o.created_at < ${end.toISOString()}
    `);
    const row = res.rows[0] as {
      revenue: string;
      cost: string;
      revenue_with_cost: string;
    };
    const revenue = Number(row.revenue);
    const cost = Number(row.cost);
    const revenueWithCost = Number(row.revenue_with_cost);
    const grossProfit = revenueWithCost - cost;
    return {
      revenue,
      cost,
      grossProfit,
      marginPct: pct(grossProfit, revenueWithCost),
      coveragePct: pct(revenueWithCost, revenue),
    };
  }

  private async discounts(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<SalesAnalytics['discounts']> {
    const res = await this.db.execute(sql`
      SELECT
        coupon_code,
        COUNT(*)::bigint AS orders,
        COALESCE(SUM(discount_amount), 0)::bigint AS discount_total,
        COALESCE(SUM(total), 0)::bigint AS revenue
      FROM orders
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND coupon_code IS NOT NULL
        AND status ${REVENUE_STATUS_IN}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
      GROUP BY coupon_code
      ORDER BY discount_total DESC
      LIMIT 10
    `);
    return (
      res.rows as {
        coupon_code: string;
        orders: string;
        discount_total: string;
        revenue: string;
      }[]
    ).map((r) => ({
      couponCode: r.coupon_code,
      orders: Number(r.orders),
      discountTotal: Number(r.discount_total),
      revenue: Number(r.revenue),
    }));
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  async getOrders(
    orgId: string,
    storeId: string,
    period: AnalyticsPeriod,
  ): Promise<OrdersAnalytics> {
    const { start, end } = getRange(period);
    const [statusBreakdown, cartAbandonment, refunds, payments, grossRevenue] =
      await Promise.all([
        this.statusBreakdown(orgId, storeId, start, end),
        this.cartAbandonment(orgId, storeId, start, end),
        this.refundTotals(orgId, storeId, start, end),
        this.paymentTotals(orgId, storeId, start, end),
        this.grossRevenue(orgId, storeId, start, end),
      ]);
    return {
      period,
      statusBreakdown,
      cartAbandonment,
      refunds: {
        ...refunds,
        refundRatePct: pct(refunds.amount, grossRevenue),
      },
      payments,
    };
  }

  private async statusBreakdown(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<OrdersAnalytics['statusBreakdown']> {
    const res = await this.db.execute(sql`
      SELECT status, COUNT(*)::bigint AS count, COALESCE(SUM(total), 0)::bigint AS revenue
      FROM orders
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
      GROUP BY status
      ORDER BY count DESC
    `);
    return (
      res.rows as { status: string; count: string; revenue: string }[]
    ).map((r) => ({
      status: r.status,
      count: Number(r.count),
      revenue: Number(r.revenue),
    }));
  }

  private async cartAbandonment(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<OrdersAnalytics['cartAbandonment']> {
    const res = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'converted')::bigint AS converted,
        COUNT(*) FILTER (WHERE status = 'abandoned')::bigint AS abandoned,
        COALESCE(SUM(total) FILTER (WHERE status = 'abandoned'), 0)::bigint AS lost_value
      FROM carts
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
    `);
    const row = res.rows[0] as {
      converted: string;
      abandoned: string;
      lost_value: string;
    };
    const convertedCount = Number(row.converted);
    const abandonedCount = Number(row.abandoned);
    return {
      convertedCount,
      abandonedCount,
      abandonmentRatePct: pct(abandonedCount, convertedCount + abandonedCount),
      lostValue: Number(row.lost_value),
    };
  }

  private async refundTotals(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<{ count: number; amount: number }> {
    const res = await this.db.execute(sql`
      SELECT COUNT(*)::bigint AS count, COALESCE(SUM(amount), 0)::bigint AS amount
      FROM refunds
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND status = 'succeeded'
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
    `);
    const row = res.rows[0] as { count: string; amount: string };
    return { count: Number(row.count), amount: Number(row.amount) };
  }

  private async paymentTotals(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<OrdersAnalytics['payments']> {
    const res = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'captured')::bigint AS captured,
        COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
        COUNT(*) FILTER (WHERE status = 'pending')::bigint AS pending
      FROM payments
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
    `);
    const row = res.rows[0] as {
      captured: string;
      failed: string;
      pending: string;
    };
    const captured = Number(row.captured);
    const failed = Number(row.failed);
    return {
      captured,
      failed,
      pending: Number(row.pending),
      successRatePct: pct(captured, captured + failed),
    };
  }

  private async grossRevenue(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const res = await this.db.execute(sql`
      SELECT COALESCE(SUM(total), 0)::bigint AS value
      FROM orders
      WHERE organization_id = ${orgId}
        AND store_id = ${storeId}
        AND status ${REVENUE_STATUS_IN}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
    `);
    return Number((res.rows[0] as { value: string }).value);
  }

  // ─── Customers ────────────────────────────────────────────────────────────

  async getCustomers(
    orgId: string,
    storeId: string,
    period: AnalyticsPeriod,
  ): Promise<CustomersAnalytics> {
    const { start, end } = getRange(period);
    // NB: `customers` is org-scoped (no store_id column), so total/new/growth
    // are per-organization. New-vs-returning is derived from store-scoped orders.
    const [totals, growth, newVsReturning] = await Promise.all([
      this.customerTotals(orgId, start, end),
      this.customerGrowth(orgId, start, end, periodDays(period)),
      this.newVsReturning(orgId, storeId, start, end),
    ]);
    return {
      period,
      totalCustomers: totals.total,
      newInPeriod: totals.newInPeriod,
      growth,
      newVsReturning,
    };
  }

  private async customerTotals(
    orgId: string,
    start: Date,
    end: Date,
  ): Promise<{ total: number; newInPeriod: number }> {
    const res = await this.db.execute(sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
        )::bigint AS new_in_period
      FROM customers
      WHERE organization_id = ${orgId}
    `);
    const row = res.rows[0] as { total: string; new_in_period: string };
    return { total: Number(row.total), newInPeriod: Number(row.new_in_period) };
  }

  private async customerGrowth(
    orgId: string,
    start: Date,
    end: Date,
    days: number,
  ): Promise<CustomersAnalytics['growth']> {
    const res = await this.db.execute(sql`
      SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*)::bigint AS count
      FROM customers
      WHERE organization_id = ${orgId}
        AND created_at >= ${start.toISOString()}
        AND created_at < ${end.toISOString()}
      GROUP BY 1
      ORDER BY 1
    `);
    const map = new Map<string, number>();
    for (const r of res.rows as { day: Date; count: string }[]) {
      map.set(new Date(r.day).toISOString().slice(0, 10), Number(r.count));
    }
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { date: key, count: map.get(key) ?? 0 };
    });
  }

  private async newVsReturning(
    orgId: string,
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<CustomersAnalytics['newVsReturning']> {
    const res = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE prior.id IS NULL)::bigint AS new_orders,
        COUNT(*) FILTER (WHERE prior.id IS NOT NULL)::bigint AS returning_orders
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT 1 AS id FROM orders p
        WHERE p.customer_id = o.customer_id
          AND p.organization_id = o.organization_id
          AND p.store_id = o.store_id
          AND p.created_at < ${start.toISOString()}
        LIMIT 1
      ) prior ON true
      WHERE o.organization_id = ${orgId}
        AND o.store_id = ${storeId}
        AND o.customer_id IS NOT NULL
        AND o.created_at >= ${start.toISOString()}
        AND o.created_at < ${end.toISOString()}
    `);
    const row = res.rows[0] as {
      new_orders: string;
      returning_orders: string;
    };
    return {
      newCustomers: Number(row.new_orders),
      returning: Number(row.returning_orders),
    };
  }

  // ─── Inventory ────────────────────────────────────────────────────────────

  async getInventory(
    orgId: string,
    storeId: string,
  ): Promise<InventoryAnalytics> {
    const [totals, lowStock] = await Promise.all([
      this.inventoryTotals(orgId, storeId),
      this.lowStockList(orgId, storeId),
    ]);
    return { ...totals, lowStock };
  }

  private async inventoryTotals(
    orgId: string,
    storeId: string,
  ): Promise<Omit<InventoryAnalytics, 'lowStock'>> {
    const res = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE (quantity - reserved) <= 0)::bigint AS out_of_stock,
        COUNT(*) FILTER (
          WHERE (quantity - reserved) > 0 AND (quantity - reserved) <= low_stock_threshold
        )::bigint AS low_stock,
        COUNT(*) FILTER (WHERE (quantity - reserved) > low_stock_threshold)::bigint AS in_stock,
        COALESCE(SUM(GREATEST(quantity - reserved, 0)), 0)::bigint AS stock_units,
        COALESCE(SUM(quantity * COALESCE(v.cost_price, 0)), 0)::bigint AS stock_value
      FROM inventory_items ii
      JOIN product_variants v ON v.id = ii.variant_id
      WHERE ii.organization_id = ${orgId}
        AND ii.store_id = ${storeId}
    `);
    const row = res.rows[0] as {
      out_of_stock: string;
      low_stock: string;
      in_stock: string;
      stock_units: string;
      stock_value: string;
    };
    return {
      outOfStockCount: Number(row.out_of_stock),
      lowStockCount: Number(row.low_stock),
      inStockCount: Number(row.in_stock),
      stockUnits: Number(row.stock_units),
      stockValueAtCost: Number(row.stock_value),
    };
  }

  private async lowStockList(
    orgId: string,
    storeId: string,
  ): Promise<InventoryAnalytics['lowStock']> {
    const res = await this.db.execute(sql`
      SELECT
        p.name AS product_name,
        v.name AS variant_name,
        v.sku AS sku,
        (ii.quantity - ii.reserved) AS available,
        ii.low_stock_threshold AS threshold
      FROM inventory_items ii
      JOIN product_variants v ON v.id = ii.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE ii.organization_id = ${orgId}
        AND ii.store_id = ${storeId}
        AND (ii.quantity - ii.reserved) <= ii.low_stock_threshold
      ORDER BY available ASC
      LIMIT 10
    `);
    return (
      res.rows as {
        product_name: string;
        variant_name: string | null;
        sku: string;
        available: number;
        threshold: number;
      }[]
    ).map((r) => ({
      productName: r.product_name,
      variantName: r.variant_name,
      sku: r.sku,
      available: Number(r.available),
      threshold: Number(r.threshold),
    }));
  }
}
