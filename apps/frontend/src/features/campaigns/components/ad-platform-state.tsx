import { AlertTriangleIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import type { Ad, AdPlatformState } from "~/types/api";
import { formatDay } from "../utils";

/**
 * What the platform says about an ad, beside what the merchant says.
 *
 * These are two independent facts and the card shows them as two: the ad's own
 * status is the merchant's word about their campaign, and this is the
 * platform's word about its own system. Nothing here can change the first, and
 * the sync that writes this never touches it either — which is the only reason
 * an ad rejected at the platform is still on the merchant's active list to be
 * looked at.
 */
const PLATFORM_STATE_LABELS: Record<AdPlatformState, string> = {
  approved: "Approved",
  rejected: "Rejected",
  in_review: "In review",
  delivering: "Delivering",
  paused: "Paused",
};

/**
 * Only two of the five are coloured, and neither is coloured for decoration:
 * rejected and paused are the states where the platform has stopped running an
 * ad the merchant believes is running, and they are the reason to look at this
 * card at all. `in_review` is amber because it is a wait rather than a problem,
 * and the two healthy states are quiet so the two that matter carry weight.
 */
const PLATFORM_STATE_STYLES: Record<AdPlatformState, string> = {
  approved: "text-muted-foreground border-border bg-muted/40",
  delivering:
    "text-emerald-700 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400",
  in_review:
    "text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400",
  paused:
    "text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400",
  rejected:
    "text-destructive border-destructive/30 bg-destructive/10 dark:bg-destructive/20",
};

/** The states where the platform is not running an ad the merchant thinks is. */
const NOT_RUNNING: AdPlatformState[] = ["rejected", "paused"];

/**
 * The platform's state, or nothing at all.
 *
 * Nothing at all is the ordinary case: an ad on an email or SMS campaign has no
 * platform to ask, and an ad whose platform ad nobody has claimed has nothing
 * to report. Rendering an empty badge for those would read as a value someone
 * failed to fill in.
 */
export function AdPlatformStateBadge({ ad }: { ad: Ad }) {
  if (!ad.platformState) return null;

  const alarming =
    ad.status === "active" && NOT_RUNNING.includes(ad.platformState);

  return (
    <Badge
      variant="outline"
      className={`shrink-0 px-2 py-0 text-[11px] font-medium ${PLATFORM_STATE_STYLES[ad.platformState]}`}
      title={
        ad.platformReportedAt
          ? `As the ad platform reported it on ${formatDay(ad.platformReportedAt)}`
          : "As the ad platform reported it"
      }
    >
      {alarming && <AlertTriangleIcon className="mr-1 h-3 w-3" />}
      {PLATFORM_STATE_LABELS[ad.platformState]} at platform
    </Badge>
  );
}

/**
 * The placement, as a label and only as a label.
 *
 * Not a filter, not a grouping, not a column anything is reported by: one ad
 * runs in several placements at once, so a report split by this would split one
 * ad's spend across values it has no split for. It is here so a merchant
 * recognises the ad the way the platform names it, and for nothing else.
 */
export function AdPlacementBadge({ placement }: { placement: string | null }) {
  if (!placement) return null;

  return (
    <Badge
      variant="outline"
      className="shrink-0 px-2 py-0 text-[11px] font-normal text-muted-foreground"
      title="Where the ad platform ran this ad"
    >
      {placement}
    </Badge>
  );
}

/**
 * The sentence the whole ad-platform sync exists to put in front of a merchant.
 *
 * An ad that is active here and rejected — or paused — there is not a
 * contradiction to be resolved into one status. It is a problem to act on: the
 * merchant believes this creative is running, the platform has stopped running
 * it, and until somebody says so the campaign quietly stops producing and
 * nothing on the page explains why. So it is said in words, under the row, and
 * not left for the merchant to infer from two badges of different colours.
 */
export function AdPlatformStateNote({ ad }: { ad: Ad }) {
  if (ad.status !== "active" || !ad.platformState) return null;
  if (!NOT_RUNNING.includes(ad.platformState)) return null;

  const reported = ad.platformReportedAt
    ? ` (reported ${formatDay(ad.platformReportedAt)})`
    : "";

  return (
    <p className="text-xs text-destructive">
      {ad.platformState === "rejected"
        ? `The ad platform has rejected this ad${reported}, so it is not running there. It stays active here with its spend and history — fix it on the platform, or archive it here.`
        : `The ad platform has this ad paused${reported}, so it is not running there. It stays active here with its spend and history.`}
    </p>
  );
}
