/**
 * Which Campaign an Order's money is credited to, and what the credit adds up
 * to — as pure functions over rows already read.
 *
 * Attribution is resolved at read time (ADR-0001): the Order stores the raw
 * Touch, and the Campaign is an interpretation of it produced here on every
 * read. That is what lets a Campaign created after its ads ran claim the Orders
 * they drove, and a corrected matching rule repair a report rather than only
 * affecting Orders that have not happened yet.
 *
 * Three things can disqualify a Touch from claiming an Order, and all three
 * land it in Unattributed rather than on a Campaign:
 *
 *  - **No Touch at all.** The visitor arrived direct, or the storefront
 *    declared nothing.
 *  - **A Touch older than the Lookback Window.** A visit six months ago did not
 *    drive today's sale.
 *  - **A bot.** The event log classified the visitor as one, matching the
 *    exclusion every other event query already applies.
 *
 * A disqualified Order still counts in the totals. Its revenue is real, it just
 * has no Campaign to credit — and the report has to reconcile with the sales
 * reports for the same period, which count it too.
 */
import type {
  AttributionTuple,
  CampaignMatcher,
} from './campaign-matching.util';
import { lookbackMs } from '../../../shared/attribution/lookback';

/** One Order, reduced to what deciding its Campaign credit actually needs. */
export interface AttributableOrder {
  /** Order total in the smallest currency unit. Never a float. */
  total: number;
  /** When the Order was placed — the anchor the Lookback Window measures from. */
  placedAt: Date;
  /**
   * The selected Touch (First or Last) as the Order froze it, and when it
   * happened. A null `at` means the Order carries no Touch of that kind.
   */
  touch: AttributionTuple & { at: Date | null };
  /** Whether the event log classified this Order's visitor as a bot. */
  isBot: boolean;
}

/**
 * The **goods basis** — a second, smaller revenue figure and the costs against
 * it, all in the smallest currency unit.
 *
 * This is not the Order total and is never meant to be. Tax is collected and
 * remitted and is never profit; shipping is excluded from both sides because
 * shipping *cost* is modelled nowhere, and counting the charge without the cost
 * would inflate every margin. What is left is the goods, which is the only part
 * of an Order there is a cost price for.
 *
 * Discounts are carried here rather than netted out in advance, because the
 * Order total already has them netted out and the two bases must not both
 * subtract them — a discounted Order penalised twice is the specific error this
 * shape exists to make hard.
 */
export interface GoodsBucket {
  /** Line-item totals *before* discount. No tax, no shipping. */
  goodsRevenue: number;
  /**
   * Cost of goods, summed only over lines whose variant has a cost price. Cost
   * price is nullable and most merchants fill it in late, so an unpriced line
   * contributes nothing here rather than a zero that would read as free.
   */
  cost: number;
  /**
   * The part of `goodsRevenue` that had a known cost behind it — the numerator
   * of cost coverage, and the figure that says how much of a margin is real.
   */
  revenueWithCost: number;
  /** Discounts on those Orders, subtracted from the goods basis exactly once. */
  discount: number;
}

/** An Order with the goods basis its Campaign's margin is built on. */
export interface CostedOrder extends AttributableOrder, GoodsBucket {}

/** Money and Order count, the two figures every line of the report carries. */
export interface RevenueBucket {
  orders: number;
  revenue: number;
}

export interface AttributionTally {
  /** Credit per Campaign id. A Campaign that earned none is simply absent. */
  byCampaign: Map<string, RevenueBucket>;
  /**
   * The goods basis of the same credit, per Campaign id — filled in the same
   * pass, from the same Order, by the same matching decision as `byCampaign`.
   * One loop rather than two on purpose: a Campaign created after its ads ran
   * gets its margin exactly when it gets its revenue, and a corrected matching
   * rule repairs both or neither.
   *
   * Kept beside `byCampaign` rather than folded into it because the two are
   * different revenue bases. A single bucket holding both would offer two keys
   * called revenue and invite the wrong one into a subtraction.
   */
  goodsByCampaign: Map<string, GoodsBucket>;
  /**
   * Everything that qualified for no Campaign. Always its own bucket — never
   * spread across Campaigns, which would make every one of them look better
   * than it is.
   *
   * No goods basis: nobody spent against Unattributed, so there is no margin to
   * build and a cost figure on this line would only invite one.
   */
  unattributed: RevenueBucket;
  /** Every Order read, credited or not. Reconciles with the sales reports. */
  totals: RevenueBucket;
}

/**
 * The Campaign that may claim this Order, or null for Unattributed.
 *
 * The window is inclusive and measured against the Order, not the clock: a
 * Touch is disqualified for being older than `lookbackDays` *before the
 * purchase*, so re-reading a report next month does not quietly move last
 * month's revenue into Unattributed.
 */
export function campaignCreditFor(
  order: AttributableOrder,
  matcher: CampaignMatcher,
  lookbackDays: number,
): string | null {
  if (order.isBot) return null;

  const touchedAt = order.touch.at;
  if (touchedAt === null) return null;

  // A Touch recorded after the order it belongs to is clock skew, not a stale
  // visit, so only the older side of the window disqualifies.
  const age = order.placedAt.getTime() - touchedAt.getTime();
  if (age > lookbackMs(lookbackDays)) return null;

  return matcher(order.touch)?.campaignId ?? null;
}

function add(bucket: RevenueBucket, order: AttributableOrder): void {
  bucket.orders += 1;
  bucket.revenue += order.total;
}

/**
 * The goods basis of one Order, added to a Campaign's running total.
 *
 * Every figure stays an integer in the smallest currency unit here, and the one
 * subtraction that makes a margin out of them happens once, at the end, in
 * `margin.util`. Summing first and subtracting last is what keeps a thousand
 * Orders adding up to the same number as one Order a thousand times over.
 */
function addGoods(bucket: GoodsBucket, order: CostedOrder): void {
  bucket.goodsRevenue += order.goodsRevenue;
  bucket.cost += order.cost;
  bucket.revenueWithCost += order.revenueWithCost;
  bucket.discount += order.discount;
}

/** Runs the credit decision over a period's Orders and sums the result. */
export function tallyAttributedRevenue(
  orders: Iterable<CostedOrder>,
  matcher: CampaignMatcher,
  lookbackDays: number,
): AttributionTally {
  const byCampaign = new Map<string, RevenueBucket>();
  const goodsByCampaign = new Map<string, GoodsBucket>();
  const unattributed: RevenueBucket = { orders: 0, revenue: 0 };
  const totals: RevenueBucket = { orders: 0, revenue: 0 };

  for (const order of orders) {
    add(totals, order);

    const campaignId = campaignCreditFor(order, matcher, lookbackDays);
    if (campaignId === null) {
      add(unattributed, order);
      continue;
    }

    let bucket = byCampaign.get(campaignId);
    if (!bucket) {
      bucket = { orders: 0, revenue: 0 };
      byCampaign.set(campaignId, bucket);
    }
    add(bucket, order);

    let goods = goodsByCampaign.get(campaignId);
    if (!goods) {
      goods = { goodsRevenue: 0, cost: 0, revenueWithCost: 0, discount: 0 };
      goodsByCampaign.set(campaignId, goods);
    }
    addGoods(goods, order);
  }

  return { byCampaign, goodsByCampaign, unattributed, totals };
}
