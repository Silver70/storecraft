import type {
  AdFormat,
  AdReviewStatus,
  CampaignPeriod,
  CampaignPlatform,
  CampaignStatus,
} from "~/types/api";

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

// ─── One campaign's page ──────────────────────────────────────────────────────

export const CAMPAIGN_PERIODS: { value: CampaignPeriod; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "lifetime", label: "Lifetime" },
];

/**
 * The period a campaign's page opens on: the last 30 days, or its whole life
 * once it has Ended — a finished campaign's last month is mostly zeroes.
 */
export function defaultCampaignPeriod(status: CampaignStatus): CampaignPeriod {
  return status === "ended" ? "lifetime" : "30d";
}

/**
 * What the platform's review said, when it is worth saying beside the status.
 * An approval or a pending review is already what the status reads, so only a
 * verdict against the ad is named.
 */
export function reviewNote(
  review: AdReviewStatus | null,
  platform: CampaignPlatform,
): string | null {
  if (review === "rejected") return `Rejected by ${formatPlatform(platform)}`;
  if (review === "with_issues") return `Flagged by ${formatPlatform(platform)}`;
  return null;
}

const COUNT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** A fraction as a percentage: `0.0375` → `3.75%`, `1.1` → `110%`. */
export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: Math.abs(ratio) < 0.1 ? 2 : 1,
  }).format(ratio);
}

/** Revenue per unit of spend: `3.2` → `3.20×`. */
export function formatRoas(roas: number): string {
  return `${roas.toFixed(2)}×`;
}
