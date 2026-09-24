/**
 * The rules a campaign draft has to meet before the platform is asked anything,
 * and the arithmetic that turns what a merchant typed into what is sent.
 *
 * Pure, and `now` is a parameter, so every rule here can be exercised without a
 * database or a clock. The platform's own dry run runs after these and has the
 * last word. These only catch what would be a waste of a call, or what the
 * platform would get subtly wrong without complaining: a start date read in the
 * server's timezone instead of the Store's, or seven ads when the form promised
 * six.
 *
 * A broken rule is reported the way the platform reports its complaints, with
 * the field and the ad it is about, so the form shows both kinds in one place.
 */
import type {
  DraftComplaint,
  DraftField,
} from '../interfaces/ad-platform-provider.interface';
import { dayInTimezone, type CalendarDay } from './sync-window.util';

/** One to six ads: enough to test creatives against each other, no more. */
export const MIN_ADS = 1;
export const MAX_ADS = 6;

/**
 * The age range a merchant can choose from. The floor is 18 rather than Meta's
 * 13: a shop's ads are shown to adults.
 */
export const AGE_FLOOR = 18;
export const AGE_CEILING = 65;

export const DRAFT_LIMITS = {
  name: 255,
  headline: 255,
  primaryText: 2000,
} as const;

/** The campaign's schedule, as instants the platform takes. */
export interface ResolvedSchedule {
  /** Null starts as soon as the platform approves it. */
  startsAt: Date | null;
  /** The end of the end day in the Store's timezone, or null for no end. */
  endsAt: Date | null;
}

/**
 * A draft broke one of the rules here. It carries complaints in the same shape
 * the platform's come in, and nothing was sent.
 */
export class DraftRuleError extends Error {
  constructor(readonly complaints: readonly DraftComplaint[]) {
    super(complaints.map((c) => c.message).join(' '));
  }
}

function complaint(
  field: DraftField,
  message: string,
  adIndex: number | null = null,
): DraftComplaint {
  return { adIndex, field, message };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * The start and end days a merchant chose, as instants in the Store's
 * timezone.
 *
 * The days are the Store's days, because that is the calendar the merchant is
 * running a promotion on. A campaign that ends "on the 30th" in Auckland must
 * not stop half a day early because the server runs in UTC.
 *
 * A start of today, or no start, means now. The platform refuses a start time
 * in the past, and midnight has already gone. A start before today is refused,
 * and so is an end before the start or an end already over.
 */
export function resolveSchedule(input: {
  startDay: CalendarDay;
  endDay: CalendarDay | null;
  timezone: string;
  now: Date;
}): ResolvedSchedule {
  const { startDay, endDay, timezone, now } = input;
  const today = dayInTimezone(now, timezone);

  if (!isRealDay(startDay)) {
    throw new DraftRuleError([
      complaint('schedule', 'Choose the day the campaign starts.'),
    ]);
  }
  if (startDay < today) {
    throw new DraftRuleError([
      complaint(
        'schedule',
        'The start date has already passed. Choose today or a later day.',
      ),
    ]);
  }
  if (endDay !== null) {
    if (!isRealDay(endDay)) {
      throw new DraftRuleError([
        complaint('schedule', 'The end date is not a real date.'),
      ]);
    }
    if (endDay < startDay) {
      throw new DraftRuleError([
        complaint('schedule', 'The end date is before the start date.'),
      ]);
    }
  }

  return {
    startsAt: startDay === today ? null : zonedMidnight(startDay, timezone),
    endsAt: endDay === null ? null : zonedMidnight(nextDay(endDay), timezone),
  };
}

/**
 * Countries as the platform takes them: two-letter codes, upper case, each
 * once, in the order chosen. At least one, because a campaign with no country
 * would be shown wherever the platform's default puts it.
 */
export function normalizeCountries(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new DraftRuleError([
        complaint('audience', `“${raw}” is not a country code.`),
      ]);
    }
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  if (out.length === 0) {
    throw new DraftRuleError([
      complaint('audience', 'Choose at least one country to show the ads in.'),
    ]);
  }
  return out;
}

/** The age range, inside what the form offers and the right way round. */
export function checkAgeRange(ageMin: number, ageMax: number): void {
  const inRange = (age: number) =>
    Number.isInteger(age) && age >= AGE_FLOOR && age <= AGE_CEILING;
  if (!inRange(ageMin) || !inRange(ageMax)) {
    throw new DraftRuleError([
      complaint(
        'audience',
        `Ages run from ${AGE_FLOOR} to ${AGE_CEILING}; 65 means 65 and over.`,
      ),
    ]);
  }
  if (ageMin > ageMax) {
    throw new DraftRuleError([
      complaint('audience', 'The youngest age is above the oldest.'),
    ]);
  }
}

/** Between one and six ads. */
export function checkAdCount(count: number): void {
  if (count < MIN_ADS || count > MAX_ADS) {
    throw new DraftRuleError([
      complaint(
        'media',
        count < MIN_ADS
          ? 'Add at least one ad.'
          : `A campaign can have at most ${MAX_ADS} ads.`,
      ),
    ]);
  }
}

/**
 * An ad's name at the platform: the campaign's, and its place in it.
 *
 * The form does not ask for one, because a merchant tells ads apart by their
 * picture. The platform needs a name, and it should be one a merchant who
 * opens Ads Manager can place.
 */
export function adName(campaignName: string, index: number): string {
  const suffix = ` · Ad ${index + 1}`;
  return campaignName.slice(0, DRAFT_LIMITS.name - suffix.length) + suffix;
}

// ─── Calendar arithmetic ──────────────────────────────────────────────────────

function nextDay(day: CalendarDay): CalendarDay {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** How far `timezone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timezone: string): number {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    // A timezone Node cannot resolve is read as UTC, as the sync reads it.
    return 0;
  }
  const parts = format.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a day begins in a timezone.
 *
 * Found by correcting a UTC guess by the zone's offset, then correcting again
 * at the answer, because the offset at midnight is not always the offset at
 * the guess: a day on which daylight saving begins has a different one.
 */
export function zonedMidnight(day: CalendarDay, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - offsetAt(guess, timezone);
  instant = guess - offsetAt(instant, timezone);
  return new Date(instant);
}
