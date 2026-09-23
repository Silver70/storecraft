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

// ─── Reading the figures ──────────────────────────────────────────────────────

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
