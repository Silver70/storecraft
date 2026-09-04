/**
 * What a Campaign returned for what it cost — the arithmetic that turns the
 * revenue report into a performance report.
 *
 * Pure on purpose, like the rest of this folder: revenue and Spend arrive as
 * integers already summed, and nothing here reads a clock, a database, or a
 * Store. The risk in this feature is arithmetic that is wrong in a way nobody
 * notices, and a function with no dependencies is one that can be exercised
 * against every case that matters.
 *
 * **ROAS is a ratio, not money.** It is the one number in this system that is
 * deliberately not an integer in minor units: 4.25 means the Campaign returned
 * $4.25 for every dollar it cost, and 425 would mean nothing at all. The
 * integer-cents rule that governs every other figure here does not apply to it,
 * and nothing downstream should "correct" it into cents.
 */

/** Revenue and Spend for one Campaign, in the smallest currency unit. */
export interface PerformanceInput {
  /** Attributed revenue — the Order-total basis Stage 1 reports. */
  revenue: number;
  /** Spend recorded for the period. */
  spend: number;
}

export interface BlendedPerformance extends PerformanceInput {
  /** Revenue over Spend across every line. Null when nothing was spent. */
  roas: number | null;
}

/**
 * Revenue divided by Spend, to two decimal places — or null when no money was
 * spent.
 *
 * **Zero Spend gives null, never zero and never infinity.** This is the
 * decision in this file most likely to be reversed by someone who has not read
 * it. Email, organic, and affiliate Campaigns live in the same table as paid
 * ones and never carry Spend: a zero would sort them to the bottom of every
 * ranking as if they had failed, and an infinity would sort them to the top as
 * if they were the best thing in the account. Neither is true — a Campaign
 * nobody funded has no return *on spend*, and the honest answer is that there
 * is no figure to show.
 *
 * Zero revenue with Spend is a real zero, though, and is exactly the row this
 * whole stage exists to surface: money went out and nothing came back.
 *
 * Two decimal places because ROAS is read as a ratio and compared against a
 * target, not reconciled against an invoice. The inputs are integers, so the
 * only rounding in this feature happens on this line.
 */
export function roasFor(revenue: number, spend: number): number | null {
  if (spend === 0) return null;
  return Math.round((revenue / spend) * 100) / 100;
}

/**
 * The account as a whole: every Campaign's Spend and revenue summed, and the
 * ROAS between the two sums.
 *
 * Summed and then divided, never averaged — a mean of per-Campaign ratios would
 * let a $5 Campaign with a lucky sale outweigh a $5,000 one, and would not be
 * the number a merchant means by "what did my ad spend return".
 *
 * The sums stay in integer minor units all the way to the single division, so
 * a thousand Orders add up to the same figure as one Order a thousand times
 * over. That is the reason revenue is never converted to a float anywhere
 * before this point.
 */
export function blendPerformance(
  lines: Iterable<PerformanceInput>,
): BlendedPerformance {
  let revenue = 0;
  let spend = 0;

  for (const line of lines) {
    revenue += line.revenue;
    spend += line.spend;
  }

  return { revenue, spend, roas: roasFor(revenue, spend) };
}
