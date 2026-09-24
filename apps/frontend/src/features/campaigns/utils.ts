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

// ─── The grid ─────────────────────────────────────────────────────────────────

/**
 * The one window every card on the grid reports. Fixed, and stated once at the
 * top of the page, so any two cards can be compared with each other.
 */
export const GRID_PERIOD = "30d" as const;

/** Running first, then the ones waiting on someone, then the finished ones. */
const STATUS_GROUP: Record<CampaignStatus, number> = {
  active: 0,
  in_review: 1,
  needs_attention: 1,
  paused: 1,
  ended: 2,
};

/** What arranging the grid needs to know about a campaign. */
type GridCampaign = {
  name: string;
  status: CampaignStatus;
  endedAt: string | null;
  revenue: number;
  hasLinkTags: boolean;
};

/**
 * Which campaigns the grid shows, in what order, and which are held back.
 *
 * Shown: every campaign that has not ended, and those that ended inside the
 * window. Held back: the ones that ended before it — out of the way, but one
 * link from sight. A campaign that ended without anyone being able to say when
 * is held back too: it reported no figure in any history this store has.
 *
 * Ordered Active, then In review / Needs attention / Paused, then Ended, and by
 * revenue within each group. A Not Tracked campaign's revenue is unknown rather
 * than zero, so it is neither ranked as a zero nor above one: it follows the
 * campaigns whose revenue can be read, in its own group.
 *
 * The search filters both halves by name, so the older link keeps counting what
 * it would reveal.
 */
export function arrangeGrid<T extends GridCampaign>(
  campaigns: readonly T[],
  windowStart: string,
  search: string,
): { shown: T[]; older: T[] } {
  const needle = search.trim().toLocaleLowerCase();
  const matching = needle
    ? campaigns.filter((c) => c.name.toLocaleLowerCase().includes(needle))
    : campaigns;

  const start = new Date(windowStart).getTime();
  const isOlder = (c: T) =>
    c.status === "ended" &&
    (c.endedAt === null || new Date(c.endedAt).getTime() < start);

  const ordered = [...matching].sort(
    (a, b) =>
      STATUS_GROUP[a.status] - STATUS_GROUP[b.status] ||
      Number(b.hasLinkTags) - Number(a.hasLinkTags) ||
      (a.hasLinkTags ? b.revenue - a.revenue : 0) ||
      a.name.localeCompare(b.name),
  );

  return {
    shown: ordered.filter((c) => !isOlder(c)),
    older: ordered.filter(isOlder),
  };
}
