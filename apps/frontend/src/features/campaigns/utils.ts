import type {
  CampaignPlatform,
  CampaignRuleField,
  CampaignRuleOperator,
} from "~/types/api";

/** Display names for the backend's `campaign_platform` enum. */
export const PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  email: "Email",
  sms: "SMS",
  affiliate: "Affiliate",
  influencer: "Influencer",
  other: "Other",
};

export function formatPlatform(platform: CampaignPlatform): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

/**
 * Display names for the rule fields, each naming the UTM parameter it reads so
 * a merchant can line a rule up against the links they actually sent out.
 */
export const RULE_FIELD_LABELS: Record<CampaignRuleField, string> = {
  utm_campaign: "Campaign tag (utm_campaign)",
  utm_source: "Source (utm_source)",
  utm_medium: "Medium (utm_medium)",
  referrer_host: "Referring site",
};

export const RULE_OPERATOR_LABELS: Record<CampaignRuleOperator, string> = {
  equals: "is",
  starts_with: "starts with",
};

/** What to show in the value box for the field being matched. */
export const RULE_VALUE_PLACEHOLDERS: Record<CampaignRuleField, string> = {
  utm_campaign: "summer_sale",
  utm_source: "instagram",
  utm_medium: "paid_social",
  referrer_host: "instagram.com",
};

/**
 * What a link for each platform is usually tagged with, as a starting point for
 * the generator.
 *
 * Only a prefill — matching normalizes both sides, so a merchant who prefers
 * `paid_social` or their own naming loses nothing by changing it. `other` is
 * left blank because guessing there would be worse than asking.
 */
export const PLATFORM_LINK_DEFAULTS: Record<
  CampaignPlatform,
  { source: string; medium: string }
> = {
  meta: { source: "facebook", medium: "paid-social" },
  google: { source: "google", medium: "cpc" },
  tiktok: { source: "tiktok", medium: "paid-social" },
  instagram: { source: "instagram", medium: "paid-social" },
  youtube: { source: "youtube", medium: "video" },
  x: { source: "x", medium: "paid-social" },
  linkedin: { source: "linkedin", medium: "paid-social" },
  pinterest: { source: "pinterest", medium: "paid-social" },
  email: { source: "newsletter", medium: "email" },
  sms: { source: "sms", medium: "sms" },
  affiliate: { source: "partner", medium: "affiliate" },
  influencer: { source: "creator", medium: "influencer" },
  other: { source: "", medium: "" },
};

// ─── Reading the figures ──────────────────────────────────────────────────────
// Every screen that shows performance shows it the same way, so the null
// semantics live here rather than being re-decided per component. They are the
// substance of the report, not formatting: a ROAS of zero and a ROAS that does
// not exist are different claims, and so are a margin of zero and a margin that
// could not be computed.

/**
 * ROAS as a ratio, which is what it is — `4.25×` means $4.25 back for every
 * dollar spent, so it never goes through the money formatter.
 *
 * A null is an em dash and not a zero: nothing was spent, so there is no return
 * on spend to report, and `0.00×` would rank an organic campaign as a failure.
 */
export function formatRoas(roas: number | null): string {
  return roas === null ? "—" : `${roas.toFixed(2)}×`;
}

/** A `YYYY-MM-DD` in the store's timezone, shown as a day and not an instant. */
export function formatDay(day: string): string {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * When a creative ran, from two optional ends.
 *
 * The ISO string is sliced to its date before formatting rather than read
 * through the browser's timezone, which would show a merchant west of UTC the
 * day before the one they typed.
 */
export function formatFlight(
  startsAt: string | null,
  endsAt: string | null,
): string | null {
  const from = startsAt ? formatDay(startsAt) : null;
  const to = endsAt ? formatDay(endsAt) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return null;
}

/**
 * The cost coverage behind a margin, said in words rather than left as a bare
 * percentage.
 *
 * Coverage is the caveat on the number beside it, so it is never far from it:
 * at 60% the margin understates cost and therefore overstates itself, and a
 * merchant who cannot see that will read a half-costed catalog as a healthy
 * one. Zero goods revenue is not low coverage — there was nothing to cost — so
 * it says what actually happened instead of reporting 0%.
 */
export function coverageNote(line: {
  goodsRevenue: number;
  costCoveragePct: number;
  spend: number;
}): string | null {
  if (line.goodsRevenue > 0) {
    return line.costCoveragePct === 100
      ? "fully costed"
      : `${line.costCoveragePct}% costed`;
  }
  return line.spend > 0 ? "spend only, no sales" : null;
}

/**
 * Money out and nothing back — the state this report exists to surface, named
 * once so the grid and the table agree on what it is and neither has to
 * rediscover it.
 */
export function isBurning(line: { spend: number; revenue: number }): boolean {
  return line.spend > 0 && line.revenue === 0;
}
