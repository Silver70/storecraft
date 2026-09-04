/**
 * The calendar day a Spend row is recorded against, and how a timestamp range
 * becomes one.
 *
 * A Spend day is a date and never an instant. Ad platforms report daily totals,
 * so any greater precision here would be invented rather than observed. The day
 * is read in the Store's timezone because that is the day the ad platform is
 * reporting — a merchant in Auckland closing out Tuesday's cost means their
 * Tuesday, not the server's.
 *
 * Pure on purpose: `now` is a parameter rather than a call to `Date.now()`, so
 * the rule that refuses a future date can be exercised without waiting for one.
 */

/** `YYYY-MM-DD`. The wire and storage format for a Spend day. */
export type SpendDay = string;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a string names a real calendar day. The pattern alone is not enough:
 * `2026-02-30` matches it and is not a date, and a Spend row recorded against
 * one would be a figure nobody could ever reconcile against a platform report.
 */
export function isCalendarDay(value: string): value is SpendDay {
  if (!DAY_PATTERN.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * A formatter for one timezone, falling back to UTC for a value Node cannot
 * resolve.
 *
 * `stores.timezone` is a free-text column, so an unusable value is reachable.
 * Falling back is deliberate: a Store whose timezone was mistyped should still
 * be able to record what it spent, off by at most a day, rather than have every
 * Spend write fail with a message about the IANA database.
 */
function dayFormatter(timezone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: timezone });
  } catch {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' });
  }
}

/** The calendar day an instant falls on, in the given timezone. */
export function dayInTimezone(instant: Date, timezone: string): SpendDay {
  const parts = dayFormatter(timezone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The latest day Spend can be recorded for: today, where the Store is. */
export function storeToday(timezone: string, now: Date): SpendDay {
  return dayInTimezone(now, timezone);
}

/**
 * The inclusive calendar day range a report period covers, in the Store's
 * timezone.
 *
 * The period itself is the `[start, end)` instant range every marketing read
 * shares, converted here rather than redefined — two definitions of "the last
 * 30 days" that disagreed by an hour would make Spend and revenue describe
 * different windows. Both ends are inclusive because a day is not an instant:
 * the day containing `end` is the day the merchant is currently spending in,
 * and dropping it would hide today's cost.
 */
export function spendDayRange(
  start: Date,
  end: Date,
  timezone: string,
): { from: SpendDay; to: SpendDay } {
  return {
    from: dayInTimezone(start, timezone),
    to: dayInTimezone(end, timezone),
  };
}
