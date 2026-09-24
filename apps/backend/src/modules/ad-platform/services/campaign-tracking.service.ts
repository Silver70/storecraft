import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AD_PLATFORM_PROVIDER,
  type AdPlatformProvider,
  type GrantedAccount,
  type LinkTagRefusal,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import { AdPlatformConnectionRepository } from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import {
  CampaignMirrorRepository,
  type MirrorScope,
} from '../repositories/campaign-mirror.repository';
import { CredentialVault } from './credential-vault.service';
import { AdPlatformSyncService } from './ad-platform-sync.service';
import { carriesOurLinkTags, mergeLinkTags } from '../utils/link-tags.util';

/** What Start tracking did to one Ad. */
export interface AdTrackingResult {
  adId: string;
  externalId: string;
  name: string;
  /**
   * - `tagged` — our tags were written just now, and the ad goes back through
   *   the platform's review.
   * - `already_tagged` — it carried them already, and nothing was written.
   * - `refused` — the platform will not retag this ad. `reason` says why.
   * - `not_attempted` — the platform failed before this ad's turn.
   */
  result: 'tagged' | 'already_tagged' | 'refused' | 'not_attempted';
  /** Why it was refused, in words a merchant can act on. Null otherwise. */
  reason: string | null;
}

/** What Start tracking did to one Campaign. */
export interface TrackingOutcome {
  campaignId: string;
  /** Whether the Campaign is Tracked now: every one of its Ads carries our tags. */
  tracked: boolean;
  /**
   * Set when the platform itself failed part-way. The ads it reached are
   * recorded as they are, and the rest are `not_attempted`. Null otherwise.
   */
  message: string | null;
  ads: AdTrackingResult[];
}

/**
 * Why an ad could not be retagged, as a merchant reads it.
 *
 * `cannot_rebuild` is chiefly an ad made from an existing post. The way out is
 * a new ad, which is measurable from its first click, and a pause on the old
 * one. Retagging it by hand in Ads Manager costs the post's engagement, which
 * is the same loss we refused to cause.
 */
const REFUSAL_REASONS: Record<LinkTagRefusal, string> = {
  cannot_rebuild:
    'Meta will not add tags to this ad without rebuilding it. This usually means it was made from an existing Facebook or Instagram post, and rebuilding it would lose that post’s likes and comments. To measure it, add a new ad and pause this one.',
  not_found:
    'Meta no longer has this ad, usually because it was deleted, so it cannot be tagged.',
  unsupported: 'This ad runs somewhere Meta does not support link tags.',
  not_applied:
    'Meta accepted the change, but the ad still does not carry the tags. Try again shortly.',
};

/**
 * Why nothing more was tagged, whatever the cause. It is about the integration,
 * not the merchant's account. The adapter's own sentences say "nothing has
 * changed", which is false once some ads are tagged.
 */
const GENERIC_FAILURE =
  'The ad platform could not be reached just now, so not every ad was tagged. Ads that were tagged keep their tags. The campaign stays Not Tracked until every ad has them, and pressing Start tracking again finishes the job.';

/**
 * Start tracking: writes our Link Tags onto every Ad of a Campaign that was
 * built somewhere else, so the revenue it drives can be measured from then on.
 *
 * ## This costs the merchant something, and nothing else calls it
 *
 * The platform treats a tag change as a new creative. The ad goes back through
 * review, and an ad made from an existing post cannot take tags without losing
 * the post's engagement. So this only runs when a merchant presses the button,
 * after being told that. The sync never calls it, and neither does anything
 * else.
 *
 * ## What it will not do
 *
 * - **Retag an ad that already carries our tags.** Each ad's tags are read
 *   from the platform again just before writing. A repeat press, or an ad the
 *   merchant tagged by hand in the meantime, costs no second review.
 * - **Rebuild a creative.** Only the tags are sent. An ad the platform cannot
 *   copy as it is gets refused and reported, and nothing is built for it.
 * - **Drop the merchant's own parameters.** Ours are merged into what the ad
 *   already carries.
 * - **Backfill.** Only clicks after the write carry the ids. Revenue from
 *   before stays unmeasurable, because nothing recorded then says which ad it
 *   came from.
 *
 * ## Failures
 *
 * A refusal about one ad is reported with the ad's name and a reason, and the
 * next ad is still tried. A failure of the platform itself stops the run:
 * the next call would most likely be refused too, against a quota other stores
 * also use. What was written stays recorded, the rest is reported as not
 * attempted, and the Campaign stays Not Tracked. Pressing Start tracking again
 * finishes the job without touching the ads already done.
 */
@Injectable()
export class CampaignTrackingService {
  private readonly logger = new Logger(CampaignTrackingService.name);

  /** Campaigns being tagged right now, so a double press is not two rebuilds. */
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(AD_PLATFORM_PROVIDER)
    private readonly provider: AdPlatformProvider,
    private readonly mirror: CampaignMirrorRepository,
    private readonly connections: AdPlatformConnectionRepository,
    private readonly credentials: AdPlatformCredentialRepository,
    private readonly vault: CredentialVault,
    private readonly sync: AdPlatformSyncService,
  ) {}

  async startTracking(
    orgId: string,
    storeId: string,
    campaignId: string,
    now: Date = new Date(),
  ): Promise<TrackingOutcome> {
    const campaign = await this.mirror.findCampaignToTrack(
      orgId,
      storeId,
      campaignId,
    );
    if (!campaign) throw new NotFoundException('Campaign not found');

    const untagged = campaign.ads.filter((ad) => !ad.hasLinkTags);
    const results = new Map<string, AdTrackingResult>(
      campaign.ads.map((ad) => [
        ad.id,
        {
          adId: ad.id,
          externalId: ad.externalId,
          name: ad.name,
          result: ad.hasLinkTags ? 'already_tagged' : 'not_attempted',
          reason: null,
        },
      ]),
    );
    const outcome = (tracked: boolean, message: string | null) => ({
      campaignId: campaign.id,
      tracked,
      message,
      ads: [...results.values()],
    });

    // Nothing to write: every ad is tagged already, or there are no ads yet.
    if (untagged.length === 0) {
      return outcome(campaign.hasLinkTags, null);
    }

    const [target] = await this.connections.findConnectedForStore(
      orgId,
      storeId,
      campaign.platform,
    );
    if (!target) {
      throw new ConflictException(
        'Meta is not connected to this store, so its ads cannot be tagged. Reconnect Meta and try again.',
      );
    }
    const { connection } = target;
    if (!connection.providerAccountRef) {
      throw new ConflictException(
        'This store’s Meta connection has no ad account chosen yet, so its ads cannot be tagged.',
      );
    }

    if (this.inFlight.has(campaign.id)) {
      throw new ConflictException(
        'This campaign’s ads are already being tagged. Wait for that to finish.',
      );
    }
    this.inFlight.add(campaign.id);

    const scope: MirrorScope = {
      organizationId: orgId,
      storeId,
      platform: campaign.platform,
    };
    let message: string | null = null;
    let written = 0;

    try {
      const account: GrantedAccount = {
        credential: await this.credentialFor(orgId, storeId),
        platform: campaign.platform,
        providerAccountRef: connection.providerAccountRef,
      };

      for (const ad of untagged) {
        const result = results.get(ad.id)!;
        try {
          // Read again, just before writing. The flag here may be up to an
          // hour old, and a rebuild we did not need costs the merchant a review.
          const current = await this.provider.readLinkTags({
            ...account,
            externalAdId: ad.externalId,
          });
          if (carriesOurLinkTags(current)) {
            await this.mirror.recordLinkTags(scope, ad.id, true, now);
            result.result = 'already_tagged';
            continue;
          }

          const write = await this.provider.writeLinkTags({
            ...account,
            externalAdId: ad.externalId,
            tags: mergeLinkTags(current),
          });
          if (write.outcome === 'refused') {
            result.result = 'refused';
            result.reason = REFUSAL_REASONS[write.reason];
            continue;
          }

          await this.mirror.recordLinkTags(scope, ad.id, true, now);
          result.result = 'tagged';
          written++;
        } catch (error) {
          message = GENERIC_FAILURE;
          this.logger.error(
            `Tagging ad ${ad.externalId} in store ${storeId} failed; stopping: ${detailOf(error)}`,
          );
          break;
        }
      }
    } catch (error) {
      // The credential could not be opened. Nothing was sent.
      message = GENERIC_FAILURE;
      this.logger.error(
        `Tagging campaign ${campaign.id} in store ${storeId} could not start: ${detailOf(error)}`,
      );
    } finally {
      this.inFlight.delete(campaign.id);
    }

    await this.mirror.refreshTracked(scope, now);

    // Each tagged ad is now a new creative in review. A sync brings that status
    // back now instead of within the hour. It reports failures rather than
    // throwing, so it cannot turn a finished tagging into an error.
    if (written > 0) {
      await this.sync.syncStore(orgId, storeId, campaign.platform, now);
    }

    const after = await this.mirror.findCampaignToTrack(
      orgId,
      storeId,
      campaign.id,
    );

    this.logger.log(
      `Start tracking on campaign ${campaign.id} in store ${storeId}: ${written} ad(s) tagged` +
        (message ? ', stopped by a platform failure' : ''),
    );
    return outcome(after?.hasLinkTags ?? false, message);
  }

  private async credentialFor(
    orgId: string,
    storeId: string,
  ): Promise<StoreCredential> {
    const row = await this.credentials.findByStore(orgId, storeId);
    if (!row?.sealedSecret) {
      throw new Error(`no credential is held for store ${storeId}`);
    }
    return {
      providerRef: row.providerRef,
      providerKeyRef: row.providerKeyRef,
      secret: this.vault.open(row.sealedSecret),
    };
  }
}

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
