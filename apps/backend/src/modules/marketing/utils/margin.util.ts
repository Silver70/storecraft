/**
 * Contribution Margin — what a Campaign actually contributed, as opposed to
 * what it grossed.
 *
 * ROAS answers "how much came back". This answers "should I keep spending",
 * and they are different questions: a 3× ROAS on a product with a 70% cost of
 * goods loses money on every order. The two live side by side on the report and
 * neither replaces the other.
 *
 * **Built on the goods basis, not the Order total.** That is the decision this
 * file turns on, and it has three parts:
 *
 *  - **Tax is out.** It is collected on someone else's behalf and remitted. It
 *    was never the merchant's money and is never profit.
 *  - **Shipping is out of both sides.** Shipping *cost* is modelled nowhere in
 *    this system, so counting the charge would credit revenue against a cost
 *    that never appears — inflating every margin, worst on the smallest orders.
 *  - **Discounts come off once.** They are already netted out of an Order's
 *    total at checkout, so subtracting them from that figure would penalise a
 *    discounted Order twice. On the goods basis — line totals *before*
 *    discount — they come off exactly once, here.
 *
 * Pure, like the rest of this folder: integers in, integers out, no clock, no
 * database, no Store. The risk in a cost report is arithmetic that is wrong in
 * a way nobody notices for a quarter, and a function with no dependencies is
 * one that can be exercised against every case that matters.
 */
import { pct } from '../../../shared/utils/percent.util';
import type { GoodsBucket } from './attributed-revenue.util';

/** A Campaign's goods basis and what it cost to buy the traffic. */
export interface MarginInput extends GoodsBucket {
  /** Spend recorded for the period, in the smallest currency unit. */
  spend: number;
}

export interface CampaignMargin {
  /**
   * Goods revenue minus discounts minus cost of goods minus Spend, in the
   * smallest currency unit. Negative when the Campaign lost money, and never
   * clamped — a loss is the most useful thing this report can tell anyone.
   *
   * Null when no cost is known at all: see `marginFor`.
   */
  contributionMargin: number | null;
  /**
   * How much of the goods revenue had a known cost behind it, as a whole-number
   * percentage. **Display only** — the same convention the analytics profit
   * report uses, from the same `pct`, so the two screens cannot drift into
   * meaning different things by "coverage".
   */
  costCoveragePct: number;
}

/** A Campaign that sold nothing still has a bucket; this is what it holds. */
export const NO_GOODS: GoodsBucket = {
  goodsRevenue: 0,
  cost: 0,
  revenueWithCost: 0,
  discount: 0,
};

/**
 * The margin, and the coverage that qualifies it.
 *
 * **A margin with no cost behind it is refused, not estimated.** Cost price is
 * nullable on variants and most merchants fill it in late, so a Campaign that
 * sold real goods none of which have a cost price would otherwise report its
 * entire revenue as margin — a number that looks like a triumph and is
 * fiction. That is worse than a blank, because a blank prompts someone to go
 * and enter their costs. So when goods were sold and none of them were costed,
 * the answer is null and the coverage beside it says why.
 *
 * **Partial coverage still reports a margin.** Half-costed is not the same as
 * uncosted: the figure is real as far as it goes, understating cost and so
 * overstating margin, and the coverage percentage is what says how far it goes.
 * Refusing it would hide the entire report from every merchant mid-way through
 * entering their costs, which is most of them.
 *
 * **Selling nothing is not missing data.** A Campaign that spent money and
 * earned nothing has no cost prices to be missing — its contribution is exactly
 * the money it burned, `-spend`, and that row is the most actionable one in an
 * ad account. Coverage is reported as 0% there because there is no revenue to
 * take a share of, not because cost data is absent; the two look alike in the
 * percentage and are told apart by whether any goods revenue exists at all.
 */
export function marginFor(input: MarginInput): CampaignMargin {
  const costCoveragePct = pct(input.revenueWithCost, input.goodsRevenue);

  if (input.goodsRevenue > 0 && input.revenueWithCost === 0) {
    return { contributionMargin: null, costCoveragePct };
  }

  return {
    contributionMargin:
      input.goodsRevenue - input.discount - input.cost - input.spend,
    costCoveragePct,
  };
}

/**
 * The account as a whole: every Campaign's goods basis and Spend summed, and
 * one margin taken of the sums.
 *
 * Summed then subtracted, never a sum of per-Campaign margins — the two agree
 * on the total but not on coverage, which has to be the share of *all* the
 * goods revenue that was costed, not an average of shares. And a Campaign whose
 * own margin is refused for want of cost data still contributes its revenue,
 * its discounts and its Spend here: the blended figure is about the account, and
 * the account really did take that money in and pay that cost out.
 */
export function blendMargin(
  lines: Iterable<MarginInput>,
): MarginInput & CampaignMargin {
  const summed: MarginInput = { ...NO_GOODS, spend: 0 };

  for (const line of lines) {
    summed.goodsRevenue += line.goodsRevenue;
    summed.cost += line.cost;
    summed.revenueWithCost += line.revenueWithCost;
    summed.discount += line.discount;
    summed.spend += line.spend;
  }

  return { ...summed, ...marginFor(summed) };
}
