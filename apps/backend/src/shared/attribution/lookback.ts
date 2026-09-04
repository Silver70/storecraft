/**
 * The Lookback Window: how far back a Touch may be and still claim credit for
 * the Order that followed it.
 *
 * This is the number that makes attributed revenue differ from what an ad
 * platform reports — Meta defaults to a 7-day click window, so a 30-day
 * lookback credits more conversions than Meta does — which is why every
 * endpoint reporting attributed figures returns it, and why the reports show it
 * next to the numbers rather than leaving the merchant to guess.
 */

/**
 * Thirty days is the industry starting point, not a researched answer. Someone
 * considering a several-thousand-dollar purchase may take longer, and their
 * genuinely campaign-driven Order would report as Unattributed — which is why
 * this is an environment variable and not a constant.
 */
export const DEFAULT_ATTRIBUTION_LOOKBACK_DAYS = 30;

/**
 * A ceiling, not a recommendation. A window longer than a year credits ads that
 * any honest reading would call spent, and an accidental extra zero in the
 * environment should not silently produce one.
 */
export const MAX_ATTRIBUTION_LOOKBACK_DAYS = 365;

/**
 * Reads `ATTRIBUTION_LOOKBACK_DAYS`, falling back to the default rather than
 * throwing: a malformed value should degrade the report's window, not stop the
 * application from booting.
 */
export function resolveLookbackDays(raw: unknown): number {
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;

  if (!Number.isFinite(parsed)) return DEFAULT_ATTRIBUTION_LOOKBACK_DAYS;

  const days = Math.floor(parsed);
  if (days < 1) return DEFAULT_ATTRIBUTION_LOOKBACK_DAYS;

  return Math.min(days, MAX_ATTRIBUTION_LOOKBACK_DAYS);
}

/** The window as milliseconds, the unit every comparison against a Touch uses. */
export function lookbackMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
