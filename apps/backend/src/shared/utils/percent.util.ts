/**
 * The one definition of a reported percentage in this codebase.
 *
 * Every `*Pct` field an admin report returns — margin, cost coverage, refund
 * rate, cart abandonment, payment success — is this function. It lives here
 * rather than beside any one of them because a second definition is how two
 * reports come to disagree about what "coverage" means while both looking
 * right, and a merchant reading 62% on one screen and 61.8% on another has no
 * way to tell which one is lying.
 *
 * **A whole number, and display-only.** Percentages are rounded here and are
 * never arithmetic inputs — nothing downstream multiplies a figure back out of
 * one. The money they describe stays an integer in the smallest currency unit
 * and is reported separately, so the rounding costs a caller nothing.
 *
 * **A zero denominator is zero, not null and not a division by zero.** There is
 * nothing to take a share of, and every caller renders the result directly.
 * Where the *absence* of a denominator has to be told apart from a real zero —
 * a Campaign with no spend has no ROAS, and one with no cost data has no
 * Contribution Margin — that is the caller's decision to make and to explain,
 * not something a percentage helper can express.
 */
export function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/**
 * The same percentage, to one decimal place — for the rates a whole number
 * would destroy rather than merely round.
 *
 * A sibling of `pct` and not a replacement for it. Every share of *money*
 * belongs above, where a whole number is honest and a decimal would imply a
 * precision the rounding does not have. This one exists for conversion rates,
 * which live between roughly 0.5% and 4%: rounded to whole numbers most of that
 * range collapses onto 1% and 2%, and a genuine 0.4% becomes 0% — a figure that
 * reads as "nobody converted" when four in a thousand did.
 *
 * Display-only and zero-denominator-safe on exactly the same terms as `pct`.
 * Callers who must tell a real zero from an absent denominator decide that
 * themselves, above this call.
 */
export function pctOneDecimal(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
