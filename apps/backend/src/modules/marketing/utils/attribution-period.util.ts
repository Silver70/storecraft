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

/**
 * The periods one Campaign's own page offers: a week, a month, a quarter, or
 * the whole of it. `today` is left out — a single day of ad figures is mostly
 * the platform still counting.
 *
 * Kept apart from `ATTRIBUTION_PERIODS` so Lifetime stays a question asked of
 * one Campaign, never of a whole Store's history in one read.
 */
export const CAMPAIGN_PERIODS = ['7d', '30d', '90d', 'lifetime'] as const;

export type CampaignPeriod = (typeof CAMPAIGN_PERIODS)[number];

/**
 * The range a Campaign period reads. Lifetime is unbounded at the start: an
 * Order can only be credited to a Campaign whose platform id its Touch carries,
 * and the platform's figures only exist for days the Campaign ran, so there is
 * nothing before the Campaign for an open start to pick up.
 */
export function resolveCampaignPeriodRange(period: CampaignPeriod): {
  start: Date;
  end: Date;
} {
  if (period === 'lifetime') return { start: new Date(0), end: new Date() };
  return resolvePeriodRange(period);
}
