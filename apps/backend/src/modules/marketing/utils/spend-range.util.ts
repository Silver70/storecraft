/**
 * One total, spread across the days it covers.
 *
 * A merchant often knows what a week cost without knowing what each day cost.
 * Range entry takes that one figure and writes one Spend row per day, because
 * the rest of this feature reads Spend per day — storing the week as a single
 * row dated Monday would make every shorter period built on it wrong.
 *
 * The division is in integer minor units, so a total that does not divide
 * evenly leaves a remainder. **The remainder goes on the first day.** It is not
 * dropped and it is not spread by some fractional rule: money that does not add
 * up is worse than money that is unevenly distributed. A merchant who typed
 * $100 across 7 days can find $100 in the rows, and reconcile it against the
 * platform invoice that says $100.
 *
 * Pure on purpose, like `spend-day.util.ts` beside it: no clock, no database,
 * no timezone. A calendar day here is already resolved in the Store's timezone
 * by the caller, and day arithmetic is done in UTC, which has no DST — the
 * distance between two calendar dates is not a question about offsets.
 */
import type { SpendDay } from './spend-day.util';

/** What one day of a range costs, once the total has been divided. */
export interface DailySpend {
  day: SpendDay;
  /** In the smallest currency unit. */
  amount: number;
}

/**
 * The longest range one entry may cover.
 *
 * A year and a day, which covers any real closeout — a merchant reconciling a
 * finished campaign is working from a platform invoice, not from 2019. The cap
 * exists because the lower end of a range is bounded by nothing at all: a
 * mistyped `1900-01-01` would otherwise ask for forty-six thousand rows in one
 * request, and the merchant who typo'd a year should be told so rather than
 * made to wait for it.
 */
export const MAX_SPEND_RANGE_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A `YYYY-MM-DD` as a UTC instant. Exact: a calendar date has no offset. */
function toUtcMillis(day: SpendDay): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromUtcMillis(millis: number): SpendDay {
  return new Date(millis).toISOString().slice(0, 10);
}

/**
 * How many days a range covers, both ends included.
 *
 * Inclusive because both ends are days a merchant spent money on: a range of
 * Monday to Monday is one day, not zero. Returns 0 for an inverted range rather
 * than a negative — the caller refuses that case with a message of its own.
 */
export function countDays(from: SpendDay, to: SpendDay): number {
  const span = toUtcMillis(to) - toUtcMillis(from);
  if (span < 0) return 0;
  return Math.round(span / MS_PER_DAY) + 1;
}

/**
 * Every calendar day in an inclusive range, oldest first.
 *
 * Empty for an inverted range. Callers validate that before calling, so an
 * empty result here is unreachable in practice — it is a defined answer rather
 * than a thrown one because this file has no opinion about HTTP.
 */
export function enumerateDays(from: SpendDay, to: SpendDay): SpendDay[] {
  const total = countDays(from, to);
  const start = toUtcMillis(from);
  return Array.from({ length: total }, (_, index) =>
    fromUtcMillis(start + index * MS_PER_DAY),
  );
}

/**
 * Divides a total across days so the rows sum to exactly the total.
 *
 * The invariant is the whole point of the function: for any non-negative
 * integer total and any non-empty list of days,
 * `splitAcrossDays(total, days)` sums to `total`. Integer division alone would
 * lose up to `days.length - 1` minor units on every uneven range, which is how
 * a report ends up quietly disagreeing with the invoice it was reconciled
 * against.
 *
 * The remainder lands on the first day. Any single day would satisfy the sum;
 * the first is chosen so the placement is predictable and explainable rather
 * than arbitrary, and so re-entering the same range produces the same rows.
 */
export function splitAcrossDays(total: number, days: SpendDay[]): DailySpend[] {
  if (days.length === 0) return [];

  const base = Math.floor(total / days.length);
  // Not `total % days.length`: derived from `base` so the sum is true by
  // construction rather than by the two operators agreeing.
  const remainder = total - base * days.length;

  return days.map((day, index) => ({
    day,
    amount: index === 0 ? base + remainder : base,
  }));
}
