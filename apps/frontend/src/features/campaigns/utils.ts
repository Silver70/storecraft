import type { AdFormat, CampaignPlatform, CampaignStatus } from "~/types/api";

/** Display names for the ad platforms a campaign can be on. */
export const PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
};

export function formatPlatform(platform: CampaignPlatform): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  active: "Active",
  paused: "Paused",
  in_review: "In review",
  needs_attention: "Needs attention",
  ended: "Ended",
};

export const FORMAT_LABELS: Record<AdFormat, string> = {
  image: "Image",
  video: "Video",
  carousel: "Carousel",
};

export function formatAdFormat(format: AdFormat | null): string | null {
  return format ? FORMAT_LABELS[format] : null;
}

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
 * A campaign's schedule, from two optional ends.
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
