/**
 * The ratios a Campaign's own page shows, as pure functions over figures
 * already read — and, more to the point, the rules for when each one is
 * **absent** rather than a number.
 *
 * Every figure here can be computed from almost any input, which is the danger:
 * a ROAS at zero spend is infinite, a ROI over half-costed goods is a confident
 * number about the other half, and a conversion rate for a Campaign whose
 * revenue nobody can see is a zero that did not happen. Each of those is
 * returned as null, and a reader shows null as a dash, never as `0`.
 *
 * Ratios are plain fractions (`0.25` is 25%). They are the one kind of number
 * here that is not money, so they are the one kind that may be fractional.
 */

/** What the Campaign's sold items cost, and how many had no cost to add. */
export interface GoodsCost {
  /** Cost price × quantity over every item that has one, in minor units. */
  cost: number;
  /** Items sold whose variant has no cost price, or no longer exists. */
  uncostedItems: number;
}

export interface CampaignFigures {
  /**
   * False for a Not Tracked Campaign: its revenue and orders are unknown, so
   * every figure built on them is too — whatever zeros the tally holds.
   */
  tracked: boolean;
  /** Attributed revenue — Order totals, already net of discounts. */
  revenue: number;
  orders: number;
  spend: number;
  clicks: number;
  goods: GoodsCost;
}

export interface CampaignRatios {
  /** Revenue ÷ spend. */
  roas: number | null;
  /** Our Orders ÷ the platform's clicks — two sources in one ratio. */
  conversionRate: number | null;
  /** Revenue − cost of goods − spend, in minor units. */
  contributionMargin: number | null;
  /** Contribution margin ÷ spend. */
  roi: number | null;
}

/** Revenue ÷ spend, or null when nothing was spent — never zero, never ∞. */
export function roas(revenue: number, spend: number): number | null {
  return spend > 0 ? revenue / spend : null;
}

/** Orders ÷ clicks, or null when nobody clicked. */
export function conversionRate(orders: number, clicks: number): number | null {
  return clicks > 0 ? orders / clicks : null;
}

/**
 * Revenue − cost of goods − spend, or null unless **every** item sold has a
 * cost price.
 *
 * Partial coverage is not a smaller number, it is a wrong one: the uncosted
 * items would be counted at a cost of zero, and the margin overstated by
 * exactly what the merchant has not told us. So one missing cost withholds the
 * whole figure.
 *
 * Discounts are not subtracted a second time. Attributed revenue is the Order
 * total, which checkout already computed net of the discount; taking it off
 * again would charge every discounted sale twice.
 */
export function contributionMargin(
  revenue: number,
  goods: GoodsCost,
  spend: number,
): number | null {
  if (goods.uncostedItems > 0) return null;
  return revenue - goods.cost - spend;
}

/** Contribution margin ÷ spend. Absent whenever the margin is, or spend is 0. */
export function roi(margin: number | null, spend: number): number | null {
  return margin !== null && spend > 0 ? margin / spend : null;
}

/**
 * Every ratio the panel shows, with the Not Tracked rule applied once: a
 * Campaign whose revenue is unknown has no ROAS, no conversion rate and no
 * margin — its spend is still real, and is shown, but nothing is divided by it.
 */
export function campaignRatios(figures: CampaignFigures): CampaignRatios {
  if (!figures.tracked) {
    return {
      roas: null,
      conversionRate: null,
      contributionMargin: null,
      roi: null,
    };
  }
  const margin = contributionMargin(
    figures.revenue,
    figures.goods,
    figures.spend,
  );
  return {
    roas: roas(figures.revenue, figures.spend),
    conversionRate: conversionRate(figures.orders, figures.clicks),
    contributionMargin: margin,
    roi: roi(margin, figures.spend),
  };
}
