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
