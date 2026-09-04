/**
 * The reporting periods every marketing read offers, and the range each resolves
 * to.
 *
 * Shared rather than copied because the rule preview's whole promise is that
 * saving the previewed rule produces the figures it showed. Two definitions of
 * "the last 30 days" that disagreed by an hour would break exactly that, and
 * would break it silently — the preview would simply have been slightly wrong.
 *
 * Marketing owns this rather than importing analytics' equivalent, exactly as
 * analytics owns its own rather than importing the dashboard's, so a report
 * module never depends on another report module.
 */
export const ATTRIBUTION_PERIODS = ['today', '7d', '30d', '90d'] as const;

export type AttributionPeriod = (typeof ATTRIBUTION_PERIODS)[number];

function periodDays(period: AttributionPeriod): number {
  if (period === 'today') return 1;
  if (period === '7d') return 7;
  if (period === '30d') return 30;
  return 90;
}

/** `[start, now)`, matching the dashboard and analytics reports exactly. */
export function resolvePeriodRange(period: AttributionPeriod): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start, end: now };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - periodDays(period));
  return { start, end: now };
}
