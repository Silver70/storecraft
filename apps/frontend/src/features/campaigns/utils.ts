import type { CampaignPlatform } from "~/types/api";

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
