import { Injectable, Logger } from '@nestjs/common';
import type { AdPlatformState } from '../../../shared/database/schema';
import { AD_LIMITS } from '../../../shared/database/schema';
import { AdRepository } from '../repositories/ad.repository';
import { planPlatformMirror } from '../utils/platform-mirror.util';

/** How the platform described one of its ads, beyond what it spent. */
export interface PlatformAdMirror {
  /** The ad's id at the platform. What an Ad claims to receive this. */
  externalAdId: string;
  platformState: AdPlatformState | null;
  placement: string | null;
}

export interface ApplyPlatformMirrorInput {
  organizationId: string;
  storeId: string;
  ads: readonly PlatformAdMirror[];
}

export interface PlatformMirrorOutcome {
  /** Ads whose platform state and placement were recorded. */
  written: number;
  /**
   * Ads the platform reported that nothing in this Store claims.
   *
   * Not a failure and not a loss: the ad is held as an Unlinked Ad and its
   * money is in `ad_reported_figures`. There is simply no Ad to put a state on,
   * and a sync does not create one.
   */
  unclaimed: number;
}

/**
 * The one path by which an ad platform's view of an ad reaches an Ad here.
 *
 * ## The single rule this service exists to hold
 *
 * **It never writes `ads.status`, under any circumstance.** Not when the
 * platform says `paused`, not when it says `rejected`, not when it stops
 * reporting the ad at all. `status` is the merchant's word about their own
 * campaign — it decides what is on their active list and what their history
 * hangs off — and `platform_state` is somebody else's word about somebody
 * else's system. An ad rejected at the platform that quietly archived itself
 * here would take its card, its spend and its revenue out of the merchant's
 * active view at exactly the moment they most need to look at it.
 *
 * The enforcement is structural rather than remembered: this service's only
 * write is `AdRepository.recordPlatformMirror`, which takes no patch and sets
 * three named columns. There is no argument to any method here that could
 * carry a status.
 *
 * The converse holds too, and needs no code: nothing in the merchant's own
 * paths writes `platform_state`. `AdService.update` does not accept it, and
 * archiving an Ad leaves it exactly as the platform last reported it.
 *
 * ## Why a placement is not a dimension
 *
 * It is carried here as a label and stored as one. One ad runs in several
 * placements at once, so a report grouped by this column would split an ad's
 * spend across values it has no split for. Nothing reads it but the card.
 *
 * ## What happens when the platform goes quiet
 *
 * Nothing. An ad the platform stopped reporting keeps what it last said, dated
 * by `platform_reported_at` so the card can show how old the claim is. An ad
 * drops out of a tree for reasons that are not facts about the ad — it fell
 * outside the window, a quota refusal truncated the answer, the account was
 * disconnected — and clearing on absence would flicker a merchant's card
 * against the sync's luck. The one thing that clears it is an Ad ceasing to
 * claim a platform ad at all, which `forget` does.
 */
@Injectable()
export class PlatformMirrorService {
  private readonly logger = new Logger(PlatformMirrorService.name);

  constructor(private readonly ads: AdRepository) {}

  /**
   * Records what the platform said about each claimed Ad, beside its own
   * status.
   *
   * Returns what happened rather than throwing it, for the reason every step of
   * a sync does: an ad nothing claims is not an error, and none of this is
   * worth costing a merchant their figures over.
   */
  async apply(
    input: ApplyPlatformMirrorInput,
    reportedAt: Date = new Date(),
  ): Promise<PlatformMirrorOutcome> {
    if (input.ads.length === 0) return { written: 0, unclaimed: 0 };

    const claimed = await this.ads.claimedByExternalId(
      input.organizationId,
      input.storeId,
    );

    const rows = planPlatformMirror({
      reported: input.ads,
      claimedByAds: claimed,
      maxPlacementLength: AD_LIMITS.placement,
    });

    let written = 0;
    for (const row of rows) {
      const ok = await this.ads.recordPlatformMirror(
        row.adId,
        input.organizationId,
        input.storeId,
        {
          platformState: row.platformState,
          placement: row.placement,
          reportedAt,
        },
      );
      if (ok) written += 1;
    }

    const unclaimed = input.ads.length - rows.length;
    if (written) {
      this.logger.log(
        `Recorded the platform's own state against ${written} ad(s) in store ${input.storeId}. No ad's own status was changed.`,
      );
    }

    return { written, unclaimed };
  }

  /**
   * Drops what the platform said about one Ad.
   *
   * Called when a claim is undone, and only then. The Ad no longer points at a
   * platform ad, so a preserved `rejected` on it would be a confident sentence
   * about an ad that is not this one's any more. Its own status is untouched,
   * here as everywhere.
   */
  async forget(
    organizationId: string,
    storeId: string,
    adId: string,
  ): Promise<void> {
    await this.ads.clearPlatformMirror(adId, organizationId, storeId);
  }
}
