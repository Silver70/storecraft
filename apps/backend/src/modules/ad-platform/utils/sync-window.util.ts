/**
 * What range a sync asks the platform for, and how long it waits after a
 * refusal — plus the one thing both need first, which calendar day it is.
 *
 * The range and the backoff are decisions rather than mechanics, which is why
 * they are here rather than inline in the service: the range decides whether the
 * feature is useful on day one, and the backoff decides whether a shared
 * upstream quota is something we wait out or something we make worse.
 *
 * A day here is a date and never an instant. Platforms report daily totals, so
 * any greater precision would be invented rather than observed, and the day is
 * read in the Store's timezone because that is the day the platform is
 * reporting — a merchant in Auckland reading Tuesday's figures means their
 * Tuesday, not the server's.
 *
 * `dayInTimezone` is the only impure thing in the file, and only in that it
 * formats: `now` is a parameter everywhere above it, so every window this
 * computes can be exercised without waiting for a date to arrive.
 */

/** `YYYY-MM-DD`. The wire format for a platform's reporting day. */
export type CalendarDay = string;

/**
 * A formatter for one timezone, falling back to UTC for a value Node cannot
 * resolve.
 *
 * `stores.timezone` is a free-text column, so an unusable value is reachable.
 * Falling back is deliberate: a Store whose timezone was mistyped should still
 * get its figures, off by at most a day, rather than have every sync fail with
 * a message about the IANA database.
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
export function dayInTimezone(instant: Date, timezone: string): CalendarDay {
  const parts = dayFormatter(timezone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * How far back a first sync asks for.
 *
 * A first connection backfills the history the platform offers rather than
 * starting from today, so the report is worth reading the moment it is
 * connected instead of in a month. The platform's own limit wins where it is
 * shorter — asking for more than it retains returns nothing extra and spends
 * quota doing it.
 */
export const DEFAULT_BACKFILL_DAYS = 90;

/**
 * How many recent days every sync re-pulls.
 *
 * Platforms restate: spend and clicks are adjusted days after the fact, and
 * yesterday's number is not final. Re-pulling a trailing window is what keeps a
 * figure current, and it is only safe because the write is an upsert keyed on
 * the platform's ad and the day — the same reason the analytics rollup re-rolls
 * its last complete days.
 */
export const RESTATEMENT_DAYS = 7;

/**
 * The most days one sync will ever ask for.
 *
 * A ceiling on a range computed from a stored timestamp: a clock skew, a
 * restored backup or a connection untouched for a year must not turn into a
 * single request for four thousand ad-days. The next sync picks up whatever
 * this one did not reach.
 */
export const MAX_SYNC_RANGE_DAYS = 400;

/** The first wait after a refusal. */
export const BACKOFF_BASE_MINUTES = 15;

/**
 * The longest a connection is held out of the schedule.
 *
 * Capped at half a day so a platform that recovers overnight is picked up the
 * following morning rather than a week later. A merchant pressing Sync now is
 * never held by this at all — they are one call, not a retry loop.
 */
export const MAX_BACKOFF_MINUTES = 12 * 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A `YYYY-MM-DD` as a UTC instant. Exact: a calendar date has no offset. */
function toUtcMillis(day: CalendarDay): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromUtcMillis(millis: number): CalendarDay {
  return new Date(millis).toISOString().slice(0, 10);
}

/** The calendar day `days` before `day`. Day arithmetic in UTC, which has no DST. */
export function daysBefore(day: CalendarDay, days: number): CalendarDay {
  return fromUtcMillis(toUtcMillis(day) - days * MS_PER_DAY);
}

export interface SyncWindow {
  /** Inclusive, `YYYY-MM-DD` in the Store's timezone. */
  from: CalendarDay;
  /** Inclusive, and always today: the day the merchant is spending in. */
  to: CalendarDay;
  /**
   * Whether this is the backfill of a connection that has never synced.
   * Recorded so the log says which kind of pull a range belongs to, and so a
   * test can assert that day one asked for history rather than for today.
   */
  backfill: boolean;
}

export interface SyncWindowInput {
  /** Today, in the Store's timezone. */
  today: CalendarDay;
  /** The day the last *successful* sync covered up to, or null if none has. */
  lastSyncedDay: CalendarDay | null;
  /** How far back this platform will report, as the provider states it. */
  maxBackfillDays: number;
}

/**
 * The range to ask the platform for.
 *
 * Two cases, and the difference between them is the feature working on day
 * one. A connection that has never synced asks for history; one that has asks
 * for a trailing window that overlaps what it already holds, because the rows
 * it already holds are not final.
 *
 * Both ends are inclusive, because a day is not an instant: `to` is the day the
 * merchant is currently spending in, and dropping it would hide today's cost.
 */
export function syncWindow(input: SyncWindowInput): SyncWindow {
  const { today, lastSyncedDay, maxBackfillDays } = input;
  const backfill = lastSyncedDay === null;

  const span = backfill
    ? Math.min(Math.max(maxBackfillDays, 0), MAX_SYNC_RANGE_DAYS)
    : RESTATEMENT_DAYS;

  const anchor =
    backfill || lastSyncedDay > today
      ? // A `lastSyncedDay` in the future is a clock the merchant did not set.
        // Anchoring on today rather than trusting it keeps the window sane.
        today
      : lastSyncedDay;

  const from = daysBefore(anchor, span);
  const floor = daysBefore(today, MAX_SYNC_RANGE_DAYS);

  return { from: from < floor ? floor : from, to: today, backfill };
}

/**
 * When the schedule may next attempt a connection that just failed.
 *
 * Doubling, capped. The refusal a merchant is most likely to hit is a quota
 * shared across every customer of the provider, which no amount of retrying
 * earns a larger share of — backing off is the only response that helps, and
 * retrying hard is the response that makes a shared limit worse for everyone
 * behind it, this Organization included.
 */
export function backoffUntil(now: Date, consecutiveFailures: number): Date {
  const attempt = Math.max(consecutiveFailures, 1);
  const minutes = Math.min(
    BACKOFF_BASE_MINUTES * 2 ** (attempt - 1),
    MAX_BACKOFF_MINUTES,
  );
  return new Date(now.getTime() + minutes * 60 * 1000);
}
