/**
 * The rules a Purchase Event dispatch turns on, separated from the plumbing that
 * applies them.
 *
 * Three of them decide whether a customer's data leaves this system at all, and
 * those are the ones worth being able to read on one screen and test without a
 * database: whether the visitor agreed to be measured, whether the platform can
 * still do anything with the event, and what a contact detail looks like once it
 * has been tidied up. The rest of the file is arithmetic on dates.
 *
 * Everything here is pure and takes `now` as data.
 */

import type { MeasurementConsent } from '../../../shared/database/schema';

/**
 * How long after a purchase the platform can still attribute it.
 *
 * Meta's click attribution window is seven days, and an event that arrives after
 * it is accepted and then attributed to nobody. So this is not a tidying rule:
 * past it, a dispatch is a customer's contact details sent to an ad platform in
 * exchange for nothing, which is the one trade this feature must not make. A
 * dispatch still owed at the boundary is recorded `expired` rather than retried
 * forever against a window that has closed.
 */
export const ATTRIBUTION_WINDOW_DAYS = 7;

/**
 * How long a claimed dispatch is left alone before another claimant may take it.
 *
 * Shorter than the scheduled job's period, so a failure is retried on the very
 * next run rather than skipped by its own lease. Longer than any single attempt
 * could reasonably take, so the job and a just-paid Order cannot both be
 * reporting the same purchase at the same moment — the platform would deduplicate
 * them on the event id, but our own count of attempts and our record of what was
 * sent would both be wrong, and those are the only things that know a purchase
 * was reported at all.
 */
export const CLAIM_LEASE_MINUTES = 10;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * The Order statuses a purchase has happened in.
 *
 * The four that count as realized revenue everywhere else in this codebase, plus
 * **`refunded`** — which is not an oversight. A refund does not un-happen a
 * purchase: the money moved, the browser's Pixel already reported it, and the
 * platform offers no retraction to follow up with (see `NO_RETRACTION` below).
 * Withholding the server's copy of a refunded sale would leave the platform
 * holding the browser's copy alone, which is the half-missing picture this whole
 * ticket exists to avoid.
 *
 * `pending` and `cancelled` are absent because no purchase happened in either.
 */
export const PURCHASED_ORDER_STATUSES = [
  'paid',
  'processing',
  'shipped',
  'delivered',
  'refunded',
] as const;

/**
 * Why a refund is never retracted, written here because this is the file
 * somebody would open to add it.
 *
 * The platform has no retraction for a web conversion. Meta's adjustment API
 * covers Google Ads only; sending a negative or zero-value Purchase does not
 * remove the original, it records a second purchase. So there is no call to make,
 * and the ones that could be made are worse than doing nothing.
 *
 * The consequence is stated rather than hidden: the platform's purchase count
 * drifts above ours by however much was refunded. Our own revenue already
 * excludes refunded Orders, so nothing a merchant reads on these screens is
 * affected — the drift is inside the platform's own reporting, where we do not
 * publish a figure anyway (ADR-0006: its revenue, conversions and ROAS are
 * neither stored nor shown). Accepted, deliberately.
 */
export const NO_RETRACTION =
  'The ad platform offers no retraction for a web conversion; a refund is not reported.';

/** What a Store asks of a visitor, and what this visitor answered. */
export interface ConsentState {
  /** Whether this Store's storefront asks before it measures anything. */
  consentRequired: boolean;
  /**
   * The answer frozen onto the Order at checkout, or null where the question was
   * never put — which is not a third answer.
   */
  consent: MeasurementConsent | null;
}

/**
 * Whether this Order's purchase may be reported to the ad platform.
 *
 * A Store that does not ask reports every sale, which is the default and the
 * behaviour a merchant who needs no banner should get. A Store that does ask
 * reports only what was agreed to, and treats everything other than a `granted`
 * as no: an unanswered banner is not a yes, and neither is an Order placed
 * before the switch was turned on.
 *
 * This gate covers a send that happens minutes or hours after the sale, from a
 * job with no cookie and no browser, which is the reason the answer is frozen
 * onto the Order rather than read from the visitor. An email address and an IP
 * are personal data exactly as a page view is.
 */
export function mayReportPurchase(state: ConsentState): boolean {
  if (!state.consentRequired) return true;
  return state.consent === 'granted';
}

/** Whether the platform can still attribute a purchase made at `occurredAt`. */
export function withinAttributionWindow(occurredAt: Date, now: Date): boolean {
  return (
    now.getTime() - occurredAt.getTime() < ATTRIBUTION_WINDOW_DAYS * MS_PER_DAY
  );
}

/** The oldest purchase still worth reporting at `now`. */
export function attributionWindowStart(now: Date): Date {
  return new Date(now.getTime() - ATTRIBUTION_WINDOW_DAYS * MS_PER_DAY);
}

/** The instant before which a claimed dispatch may be claimed again. */
export function claimableBefore(now: Date): Date {
  return new Date(now.getTime() - CLAIM_LEASE_MINUTES * MS_PER_MINUTE);
}

/**
 * An email address as a match key, or null where there is nothing to match on.
 *
 * Trimmed and lowercased, which is the whole of the normalization Meta specifies
 * for an email and the part a hash makes unforgiving: `Ada@Example.com` and
 * `ada@example.com` hash to two different values and match two different people.
 * The `@` check is not validation — it is the difference between a match key and
 * a string somebody typed into the wrong field.
 */
export function asEmailMatchKey(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
}

/**
 * A phone number as a match key, or null where there is too little of one.
 *
 * Whitespace collapsed and nothing else: the platform normalizes numbers itself,
 * and a number the merchant captured without a country code cannot be given one
 * by guessing. Fewer than seven digits is not a phone number in any country, and
 * sending it would spend a match key to say nothing.
 */
export function asPhoneMatchKey(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().replace(/\s+/g, '');
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 ? trimmed : null;
}
