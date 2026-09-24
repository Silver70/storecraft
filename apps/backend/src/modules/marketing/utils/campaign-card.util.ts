/**
 * The two things a Campaign's card shows that its own row does not hold, as
 * pure functions over rows already read.
 *
 * Both are about the Campaign's whole life rather than a report's period: the
 * picture it is recognised by, and when it stopped.
 */

/** One Ad, reduced to what deciding its Campaign's card needs. */
export interface CardAd {
  id: string;
  creativeUrl: string | null;
  createdAt: Date;
}

/** One Ad's whole history. An Ad the platform never reported has none. */
export interface CardAdLifetime {
  /** In minor units. */
  spend: number;
  /** The last `YYYY-MM-DD` the platform reported a figure for the Ad. */
  lastDay: string;
}

/**
 * The picture the Campaign is shown with: its own Cover, or failing that the
 * creative of the Ad that has spent the most.
 *
 * The same pick the sync makes when it fills a missing Cover
 * (`CampaignMirrorRepository.fillMissingCovers`) — most spend, then the oldest
 * Ad, then the id — so a card never shows one picture before a sync and
 * another after it. Made here as well because the sync's copy is only as fresh
 * as the last sync, and a Campaign with a creative on file should never be
 * drawn as a blank tile.
 *
 * Only Ads with a creative are candidates. Null when none has one.
 */
export function coverFor(
  ownCover: string | null,
  ads: readonly CardAd[],
  lifetime: ReadonlyMap<string, CardAdLifetime>,
): string | null {
  if (ownCover) return ownCover;

  let best: { ad: CardAd; spend: number } | null = null;
  for (const ad of ads) {
    if (!ad.creativeUrl) continue;
    const spend = lifetime.get(ad.id)?.spend ?? 0;
    if (
      best === null ||
      spend > best.spend ||
      (spend === best.spend &&
        (ad.createdAt.getTime() < best.ad.createdAt.getTime() ||
          (ad.createdAt.getTime() === best.ad.createdAt.getTime() &&
            ad.id < best.ad.id)))
    ) {
      best = { ad, spend };
    }
  }
  return best?.ad.creativeUrl ?? null;
}

/**
 * When an Ended Campaign stopped, or null when it has not ended or there is no
 * way to tell.
 *
 * Its scheduled end, when that has passed — that is when it stopped. Otherwise
 * (deleted on the platform, or its schedule never had an end) the last day any
 * of its Ads reported a figure, which is the last day it did anything. A
 * Campaign that ended without ever reporting one has no answer, and reads as
 * ended long ago: it spent nothing in any history this Store holds.
 */
export function endedAtFor(
  campaign: { status: string; endsAt: Date | null },
  ads: readonly CardAd[],
  lifetime: ReadonlyMap<string, CardAdLifetime>,
  now: Date,
): Date | null {
  if (campaign.status !== 'ended') return null;
  if (campaign.endsAt && campaign.endsAt.getTime() <= now.getTime()) {
    return campaign.endsAt;
  }

  let lastDay: string | null = null;
  for (const ad of ads) {
    const day = lifetime.get(ad.id)?.lastDay;
    if (day && (lastDay === null || day > lastDay)) lastDay = day;
  }
  return lastDay === null ? null : new Date(`${lastDay}T00:00:00.000Z`);
}
