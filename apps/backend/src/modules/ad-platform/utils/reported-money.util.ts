/**
 * Where the ad platform's decimals stop being decimals.
 *
 * The vendor reports money the way its dashboard displays it — `2.675` dollars,
 * not `268` cents — and whole currency units for the budget fields this stage
 * does not store. This codebase holds money as integers in the smallest
 * currency unit and nowhere else, so a float crossing the network boundary has
 * to be converted immediately, at the edge, by the adapter that received it.
 *
 * **No float reaches a service, a repository or a report.** That is the whole
 * job of this file. The failure it prevents is not a crash: a float that
 * survives into a figure adds up wrongly by fractions of a cent per row, over
 * thousands of rows, and reconciles against nothing — a report that is quietly
 * off and never throws is the most expensive kind this codebase has.
 *
 * Pure on purpose, and tested at boundary values, because the rounding rule is
 * the part that fails silently: `2.675 * 100` is `267.49999999999994` in IEEE
 * 754, so the obvious implementation loses a cent on a figure a merchant can
 * read off their own invoice.
 */

/**
 * Minor units per major unit.
 *
 * A flat hundred, matching the assumption every money column in this codebase
 * already makes (`money.util.format` divides by 100 for every currency). It is
 * wrong for the zero-decimal currencies — JPY, KRW — and deliberately wrong the
 * same way as everything around it: a platform figure in yen scaled by 1 beside
 * an order total in yen scaled by 100 would be two unit systems inside one
 * report, which is worse than one consistent offset. Fixing it is a
 * codebase-wide change, starting at `money.util`, not a change to this file.
 */
const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Significant digits kept before rounding.
 *
 * 15 is the most a double represents exactly, and normalizing to it is what
 * turns `267.49999999999994` back into the `267.5` the vendor meant. Rounding
 * without this step is the one-cent-per-row bug above.
 */
const SIGNIFICANT_DIGITS = 15;

/**
 * Scales a decimal to an integer, rounding halves **away from zero**.
 *
 * Away from zero rather than `Math.round`'s half-up, so the rule is symmetric:
 * a credit of `-0.005` and a charge of `0.005` round to the same magnitude. An
 * asymmetric rule biases a column of mixed-sign figures in one direction, which
 * is a bias nobody looking at the total would ever suspect.
 */
function scaleToInteger(value: number, factor: number): number {
  if (!Number.isFinite(value)) {
    // Not zero. A figure the platform could not state is not a figure worth
    // nothing, and writing zero would report "this ad spent nothing today" —
    // a sentence with a cost basis behind it. The sync records the failure
    // instead, and shows the merchant the figures it already had.
    throw new RangeError(
      `Expected a finite amount from the ad platform, received ${String(value)}`,
    );
  }

  const scaled = Number((value * factor).toPrecision(SIGNIFICANT_DIGITS));
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  // `-0` is a real value in JavaScript and a trap in a figure: it compares
  // equal to `0` with `===` and not with `Object.is`, so it survives a guard
  // and surprises a reader later.
  return rounded === 0 ? 0 : rounded;
}

/** A platform's decimal amount as minor units — `2.675` becomes `268`. */
export function toMinorUnits(amount: number): number {
  return scaleToInteger(amount, MINOR_UNITS_PER_MAJOR);
}

/**
 * A count the platform reported, as a whole number.
 *
 * Platforms return fractional impressions and clicks — apportioned figures
 * frequently arrive with a decimal — and a count column is an integer. Halves
 * round away from zero here too, so one rule covers the file.
 */
export function toCount(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return scaleToInteger(value, 1);
}
