/**
 * Deciding what a sync should hold, resolve and release — as a pure function.
 *
 * This is the mapping from a platform's ad tree onto the Ads a Store already
 * has, and it is pure for the reason the matcher and the money conversion are:
 * it fails without throwing. Getting it wrong does not raise an error, it
 * silently refills a merchant's review list with ads they already dismissed, or
 * quietly stops holding an ad the platform is charging them for. Neither has a
 * stack trace, so both are tested here against inputs written by hand.
 *
 * **Nothing here produces an Ad.** The whole output is decisions about
 * `unlinked_ads` rows, and every state change it proposes is carried out
 * through the one transition engine (`unlinked-ad-state.util.ts`). A sync that
 * could promote an ad on its own is the failure this stage exists to prevent.
 */
import type { UnlinkedAdState } from '../../../shared/database/schema';

/** One ad as the platform described it on this run. */
export interface PlatformAdSighting {
  readonly externalAdId: string;
  readonly name: string | null;
  readonly creativeUrl: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

export interface UnlinkedAdPlan {
  /**
   * Ads nothing in this Store claims: written as `pending` if new, and
   * otherwise refreshed in place. Refreshing updates what the ad *looks like*
   * and never what the merchant decided about it, which is what makes a
   * dismissal durable across syncs.
   */
  readonly hold: readonly PlatformAdSighting[];
  /**
   * Rows an Ad has come to claim without going through the claim flow — a
   * merchant who typed the platform id onto an Ad by hand. Resolved rather than
   * left waiting, because the question the row is asking has been answered.
   */
  readonly resolve: readonly { externalAdId: string; adId: string }[];
  /**
   * Rows recorded as claimed whose Ad no longer carries the platform id —
   * cleared by hand on the Ad, or an Ad that was deleted underneath it. Sent
   * back to `pending`, because the ad is again spending money nothing here
   * claims, which is exactly what `pending` means.
   */
  readonly release: readonly string[];
}

export interface PlanUnlinkedAdsInput {
  /** Every ad the platform reported on this run. */
  readonly sightings: readonly PlatformAdSighting[];
  /** Platform ad id → Ad id, for every Ad in this Store that carries one. */
  readonly claimedByAds: ReadonlyMap<string, string>;
  /** Platform ad id → state, for the rows this connection already holds. */
  readonly held: ReadonlyMap<string, UnlinkedAdState>;
}

export function planUnlinkedAds(input: PlanUnlinkedAdsInput): UnlinkedAdPlan {
  const hold: PlatformAdSighting[] = [];
  const resolve: { externalAdId: string; adId: string }[] = [];
  const release: string[] = [];

  // A platform reporting one ad twice in a payload is its business, not a
  // reason to write two rows. The last description wins, as it does in the
  // figures upsert.
  const seen = new Map<string, PlatformAdSighting>();
  for (const sighting of input.sightings) {
    if (!sighting.externalAdId) continue;
    seen.set(sighting.externalAdId, sighting);
  }

  for (const [externalAdId, sighting] of seen) {
    const adId = input.claimedByAds.get(externalAdId);
    const state = input.held.get(externalAdId);

    if (adId) {
      // An Ad claims it, so it is not unlinked. If a row was still waiting for
      // an answer, the answer has arrived from elsewhere.
      if (state === 'pending') resolve.push({ externalAdId, adId });
      continue;
    }

    // Nothing claims it. A row recorded as claimed is now describing a link
    // that no longer exists on the Ad, and belongs back in the merchant's list.
    if (state === 'claimed') release.push(externalAdId);

    hold.push(sighting);
  }

  return { hold, resolve, release };
}
