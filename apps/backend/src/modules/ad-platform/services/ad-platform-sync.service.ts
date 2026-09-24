import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AdPlatform } from '../../../shared/database/schema';
import { R2StorageService } from '../../../shared/storage/r2-storage.service';
import {
  AD_PLATFORM_PROVIDER,
  type AdPlatformProvider,
  type AdTree,
  type GrantedAccount,
  type ReportedAd,
  type ReportedCampaign,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import {
  AdPlatformConnectionRepository,
  type ConnectionToSync,
} from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import {
  CampaignMirrorRepository,
  type DailyFigureInput,
  type MirrorScope,
  type MirroredAd,
} from '../repositories/campaign-mirror.repository';
import { CredentialVault } from './credential-vault.service';
import { carriesOurLinkTags } from '../utils/link-tags.util';
import { collapseStatus } from '../utils/platform-status.util';
import {
  DEFAULT_BACKFILL_DAYS,
  backoffUntil,
  dayInTimezone,
  syncWindow,
} from '../utils/sync-window.util';

/** What one connection's sync did, in the terms the merchant is shown. */
export interface SyncOutcome {
  platform: AdPlatform;
  /**
   * `partial` is a sync whose figures were written but whose range the
   * platform had not finished gathering — usual for a while after a first
   * connection. It is retried like a failure, because the range is not yet
   * covered, but it is not one.
   */
  status: 'synced' | 'partial' | 'failed';
  /** Inclusive `YYYY-MM-DD` range that was asked for. */
  from: string;
  to: string;
  /** Whether this was a first connection's backfill. */
  backfill: boolean;
  /**
   * Why it failed, in words a merchant can act on, or null on success. Never a
   * stack trace, and never a sentence that blames their own account.
   */
  message: string | null;
  /** Campaigns and Ads this sync found that had no row here before. */
  campaignsDiscovered: number;
  adsDiscovered: number;
}

/** What writing one tree changed, in the terms the outcome reports. */
interface MirrorResult {
  campaignsDiscovered: number;
  adsDiscovered: number;
}

/**
 * What a merchant sees when a sync could not be completed.
 *
 * Deliberately about the integration rather than about them. Some upstream
 * quotas are shared across every customer of the provider and cannot be bought
 * out of, so a refusal frequently has nothing to do with this Organization —
 * and a merchant told to check their ad account will go and check their ad
 * account, find nothing wrong, and trust the page less afterwards.
 */
const GENERIC_FAILURE =
  'The ad platform could not be reached for this store just now. Nothing already recorded has changed, and the sync will try again shortly.';

const UNREADABLE_FIGURE =
  'The ad platform returned figures that could not be read. Nothing already recorded has changed, and the sync will try again shortly.';

const STILL_GATHERING =
  'The ad platform is still gathering this account’s history. Figures so far are shown, and the rest will arrive on the next sync.';

/**
 * The most Ads whose link tags one sync reads.
 *
 * Each read is a call of its own against a quota shared with every customer of
 * the provider, and a first backfill can discover hundreds of Ads at once. The
 * rest are read on the next sync; until then their Campaign reads Not Tracked,
 * which is the conservative answer rather than a wrong one.
 */
export const MAX_TAG_READS_PER_SYNC = 100;

/** The most creatives one sync copies. The rest are copied on the next. */
export const MAX_CREATIVE_COPIES_PER_SYNC = 50;

/**
 * Pulls what the ad platform knows, on a schedule and on demand.
 *
 * ## What this service writes
 *
 * The ad account's reality, mirrored: every Campaign and Ad on it keyed by the
 * platform's own ids, each Ad's spend, impressions and link clicks per day into
 * `ad_daily_figures`, whether each Ad carries our Link Tags, and a copy of each
 * creative in our own storage. Plus the sync state on the connection it ran
 * for. Nothing else writes the figures, and nothing here writes to the
 * platform: every call a sync makes is a read.
 *
 * A campaign discovered on the account is simply inserted. There is no claim
 * queue and no pending state. An Ad built in Ads Manager usually carries no
 * tags of ours, so its Campaign reads **Not Tracked** — revenue unknown, never
 * zero — which is the answer to "cost with no revenue reads as failure" that
 * holding it back used to be.
 *
 * ## Why the sync never sits in a read path
 *
 * It is the one part of this feature that is slow or fails. The pages read what
 * the last successful sync wrote, and a sync's failure is a sentence on the
 * connection beside those figures, never an exception inside the request that
 * wanted them.
 *
 * ## Why nothing here throws at a merchant
 *
 * Every public method returns an outcome rather than raising. A vendor outage
 * costs freshness, not the dashboard: the failure is recorded on the connection
 * and the page shows it. The scheduled job has no one to throw to in the first
 * place.
 *
 * ## Why it backs off instead of retrying
 *
 * A refused call is usually a quota shared across all of the provider's
 * customers, which no amount of retrying earns a larger share of. A failed
 * connection is held out of the schedule for a doubling interval; a merchant
 * pressing Sync now is one call rather than a retry loop and is never held.
 */
@Injectable()
export class AdPlatformSyncService {
  private readonly logger = new Logger(AdPlatformSyncService.name);

  constructor(
    @Inject(AD_PLATFORM_PROVIDER)
    private readonly provider: AdPlatformProvider,
    private readonly connections: AdPlatformConnectionRepository,
    private readonly credentials: AdPlatformCredentialRepository,
    private readonly vault: CredentialVault,
    private readonly mirror: CampaignMirrorRepository,
    private readonly storage: R2StorageService,
  ) {}

  /**
   * Every connected Store, hourly.
   *
   * Hourly rather than nightly because a merchant watching a campaign they just
   * launched wants to see it spending today, and rather than every few minutes
   * because the figures are daily totals the platform restates for days
   * afterwards — polling harder would spend a shared quota to re-read the same
   * numbers. A merchant who wants it sooner presses Refresh.
   *
   * This is a one-line delegation on purpose: the schedule is the framework's,
   * the work is `syncAllConnections`, and everything worth testing is in the
   * method rather than in the decorator.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync(): Promise<void> {
    await this.syncAllConnections();
  }

  /**
   * Syncs every connection that is due, and never throws.
   *
   * A plain public method, so a sync can be run without involving the
   * scheduler — from a script, from a test, or from the manual trigger below.
   * One connection's failure does not stop the others: they belong to
   * different Organizations, and a quota refusal on one merchant's account is
   * not a reason to leave another merchant's figures stale.
   */
  async syncAllConnections(now: Date = new Date()): Promise<SyncOutcome[]> {
    const due = await this.connections.findDueForSync(now);
    const outcomes: SyncOutcome[] = [];

    for (const target of due) {
      outcomes.push(await this.syncConnection(target, now));
    }

    const failed = outcomes.filter((o) => o.status === 'failed').length;
    if (outcomes.length) {
      this.logger.log(
        `Ad platform sync: ${outcomes.length - failed} of ${outcomes.length} connection(s) synced`,
      );
    }
    return outcomes;
  }

  /**
   * A sync for one Store, run now: the Refresh button, the first backfill
   * after connecting, and the code path that runs right after an edit made
   * here all come through this.
   *
   * Runs regardless of backoff — a person pressing a button is not a retry
   * loop, and being told "try again in four hours" by a page with a button on
   * it is not an answer. Returns what happened instead of throwing it, so a
   * refusal is something the page displays rather than an error the merchant
   * has to interpret.
   */
  async syncStore(
    orgId: string,
    storeId: string,
    platform?: AdPlatform,
    now: Date = new Date(),
  ): Promise<SyncOutcome[]> {
    const targets = await this.connections.findConnectedForStore(
      orgId,
      storeId,
      platform,
    );

    const outcomes: SyncOutcome[] = [];
    for (const target of targets) {
      outcomes.push(await this.syncConnection(target, now));
    }
    return outcomes;
  }

  /**
   * One connection: ask the platform what it knows, write down what it says
   * about each ad, record how it went.
   *
   * The whole method is inside a try, and the catch is the feature: whatever
   * goes wrong — the vendor being down, a quota refusal, a payload that cannot
   * be read — becomes a recorded failure and a sentence, not an exception
   * travelling up into whatever asked for the sync.
   */
  async syncConnection(
    target: ConnectionToSync,
    now: Date = new Date(),
  ): Promise<SyncOutcome> {
    const { connection, storeTimezone } = target;
    const today = dayInTimezone(now, storeTimezone);
    const lastSyncedDay = connection.lastSyncedAt
      ? dayInTimezone(connection.lastSyncedAt, storeTimezone)
      : null;

    let window = syncWindow({
      today,
      lastSyncedDay,
      maxBackfillDays: DEFAULT_BACKFILL_DAYS,
    });

    try {
      const credential = await this.credentialFor(connection.id, {
        orgId: connection.organizationId,
        storeId: connection.storeId,
      });

      if (window.backfill) {
        // Only on a first connection, and only because the answer changes the
        // range: a backfill asks for the history this platform actually offers
        // rather than a number we guessed.
        const health = await this.provider.health(connection.platform);
        if (!health.reachable) {
          throw new Error('the provider reported itself unreachable');
        }
        window = syncWindow({
          today,
          lastSyncedDay,
          maxBackfillDays: Math.min(
            DEFAULT_BACKFILL_DAYS,
            health.maxBackfillDays,
          ),
        });
      }

      // Both are written together when the ad account is chosen, and a
      // connection only reaches `connected` through that path — so this is a
      // row that has been tampered with rather than one mid-flow, and asking
      // the platform about an account nobody picked is not a thing to guess at.
      if (!connection.providerAccountRef || !connection.externalAccountId) {
        throw new Error(
          `connection ${connection.id} is connected without an ad account`,
        );
      }

      const account: GrantedAccount = {
        credential,
        platform: connection.platform,
        providerAccountRef: connection.providerAccountRef,
      };
      const tree = await this.provider.fetchAdTree({
        ...account,
        externalAccountId: connection.externalAccountId,
        from: window.from,
        to: window.to,
      });

      // The connection refused any other currency, and nothing in this
      // feature converts. A tree in another one is not something to write
      // beside the Store's own revenue.
      if (
        tree.currency &&
        connection.accountCurrency &&
        tree.currency.toUpperCase() !== connection.accountCurrency.toUpperCase()
      ) {
        throw new ServiceUnavailableException(
          `The ad platform reported figures in ${tree.currency}, but this store's ad account was connected in ${connection.accountCurrency}. Nothing already recorded has changed.`,
        );
      }

      const scope: MirrorScope = {
        organizationId: connection.organizationId,
        storeId: connection.storeId,
        platform: connection.platform,
      };
      const mirrored = await this.writeTree(scope, tree, window, account, now);

      if (!tree.complete) {
        // Written, but not counted as covered: `lastSyncedAt` stays where it
        // was, so the next sync asks for this range again instead of only for
        // a trailing week that would leave the rest of it empty for good.
        await this.connections.recordSyncFailure(
          connection.id,
          now,
          STILL_GATHERING,
          backoffUntil(now, connection.syncFailureCount + 1),
        );
        this.logger.log(
          `Partly synced ${connection.platform} for store ${connection.storeId}; the platform is still gathering ${window.from}…${window.to}`,
        );
        return {
          platform: connection.platform,
          status: 'partial',
          from: window.from,
          to: window.to,
          backfill: window.backfill,
          message: STILL_GATHERING,
          ...mirrored,
        };
      }

      await this.connections.recordSyncSuccess(connection.id, now);

      this.logger.log(
        `Synced ${connection.platform} for store ${connection.storeId} over ` +
          `${window.from}…${window.to}` +
          (window.backfill ? ' (backfill)' : '') +
          `: ${mirrored.campaignsDiscovered} campaign(s) and ${mirrored.adsDiscovered} ad(s) discovered`,
      );

      return {
        platform: connection.platform,
        status: 'synced',
        from: window.from,
        to: window.to,
        backfill: window.backfill,
        message: null,
        ...mirrored,
      };
    } catch (error) {
      const message = merchantMessage(error);
      // Logged in full here, where an engineer reads it, and summarized in a
      // sentence there, where a merchant does.
      this.logger.error(
        `Syncing ${connection.platform} for store ${connection.storeId} failed: ${detailOf(error)}`,
      );

      await this.connections.recordSyncFailure(
        connection.id,
        now,
        message,
        backoffUntil(now, connection.syncFailureCount + 1),
      );

      return {
        platform: connection.platform,
        status: 'failed',
        from: window.from,
        to: window.to,
        backfill: window.backfill,
        message,
        campaignsDiscovered: 0,
        adsDiscovered: 0,
      };
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * Writes one tree: Campaigns, then their Ads, then each Ad's days — then the
   * two things owed once per Ad, its link tags and its creative — then what
   * follows from all of it, Tracked and the Cover.
   *
   * Each step is an idempotent upsert, so a failure part-way leaves rows the
   * next sync simply writes again. The per-Ad reads after the figures are
   * best-effort: they cost calls against a shared quota and the merchant's
   * figures do not depend on them, so one that fails is left owed rather than
   * failing a sync whose figures have already landed.
   */
  private async writeTree(
    scope: MirrorScope,
    tree: AdTree,
    window: { from: string; to: string },
    account: GrantedAccount,
    now: Date,
  ): Promise<MirrorResult> {
    const reported = dedupeCampaigns(tree.campaigns);

    const campaignRows = await this.mirror.upsertCampaigns(
      scope,
      reported.map((campaign) => ({
        externalId: campaign.externalCampaignId,
        name: campaign.name,
        status: collapseStatus(campaign.signals, now),
        startsAt: campaign.signals.startsAt,
        endsAt: campaign.signals.endsAt,
      })),
      now,
    );
    const campaignIdOf = new Map(
      campaignRows.map((row) => [row.externalId, row.id]),
    );

    // An ad filed under two campaigns in one read is kept under the last one,
    // which is what an upsert would have done across two statements anyway.
    const reportedAds = new Map<
      string,
      { ad: ReportedAd; campaignId: string }
    >();
    for (const campaign of reported) {
      const campaignId = campaignIdOf.get(campaign.externalCampaignId);
      if (!campaignId) continue;
      for (const ad of campaign.ads) {
        reportedAds.set(ad.externalAdId, { ad, campaignId });
      }
    }

    const adRows = await this.mirror.upsertAds(
      scope,
      [...reportedAds.values()].map(({ ad, campaignId }) => ({
        campaignId,
        externalId: ad.externalAdId,
        name: ad.name,
        format: ad.format,
        status: collapseStatus(ad.signals, now),
      })),
      now,
    );

    const figures: DailyFigureInput[] = [];
    for (const row of adRows) {
      const days = new Map<string, DailyFigureInput>();
      for (const day of reportedAds.get(row.externalId)?.ad.days ?? []) {
        // Only days inside the window this sync owns. A day outside it would
        // be written without the removal pass below ever covering it.
        if (day.day < window.from || day.day > window.to) continue;
        days.set(day.day, { adId: row.id, ...day });
      }
      figures.push(...days.values());
    }
    await this.mirror.replaceFigures(
      scope,
      adRows.map((row) => row.id),
      window.from,
      window.to,
      figures,
    );

    if (tree.complete) {
      await this.mirror.markUnreportedEnded(
        scope,
        reported.map((campaign) => campaign.externalCampaignId),
        [...reportedAds.keys()],
        now,
      );
    }

    await this.readLinkTags(scope, adRows, account, now);
    await this.copyCreatives(scope, adRows, reportedAds, now);

    await this.mirror.refreshTracked(scope, now);
    await this.mirror.fillMissingCovers(scope, now);

    return {
      campaignsDiscovered: campaignRows.filter((row) => row.inserted).length,
      adsDiscovered: adRows.filter((row) => row.inserted).length,
    };
  }

  /**
   * Reads each Ad's link tags once, the first time it is seen.
   *
   * Stops at the first refusal rather than trying the next Ad: the likely
   * refusal is a quota shared with every customer of the provider, and the next
   * call would only be refused too. What was not read stays owed, and its
   * Campaign reads Not Tracked until it is — the conservative answer.
   */
  private async readLinkTags(
    scope: MirrorScope,
    adRows: readonly MirroredAd[],
    account: GrantedAccount,
    now: Date,
  ): Promise<void> {
    const owed = adRows
      .filter((row) => row.linkTagsCheckedAt === null)
      .slice(0, MAX_TAG_READS_PER_SYNC);

    for (const row of owed) {
      try {
        const urlTags = await this.provider.readLinkTags({
          ...account,
          externalAdId: row.externalId,
        });
        await this.mirror.recordLinkTags(
          scope,
          row.id,
          carriesOurLinkTags(urlTags),
          now,
        );
      } catch (error) {
        this.logger.warn(
          `Reading link tags for ad ${row.externalId} in store ${scope.storeId} failed; ` +
            `left for the next sync: ${detailOf(error)}`,
        );
        return;
      }
    }
  }

  /**
   * Copies each Ad's creative into our own storage the first time it is seen.
   *
   * The platform's image links are signed and expire within about a day, so a
   * link stored as it is would be a broken image on the grid by tomorrow. A
   * copy that fails is left owed and tried on the next sync, one Ad at a time —
   * an expired link is a fact about that link, not about the next one.
   */
  private async copyCreatives(
    scope: MirrorScope,
    adRows: readonly MirroredAd[],
    reportedAds: ReadonlyMap<string, { ad: ReportedAd }>,
    now: Date,
  ): Promise<void> {
    const owed = adRows
      .filter(
        (row) =>
          row.creativeUrl === null &&
          reportedAds.get(row.externalId)?.ad.creativeUrl,
      )
      .slice(0, MAX_CREATIVE_COPIES_PER_SYNC);

    for (const row of owed) {
      const source = reportedAds.get(row.externalId)!.ad.creativeUrl!;
      try {
        const file = await this.provider.fetchCreative(source);
        const key = `ad-creatives/${scope.organizationId}/${scope.storeId}/${row.id}.${extensionFor(file.contentType)}`;
        const url = await this.storage.upload(key, file.body, file.contentType);
        await this.mirror.recordCreative(scope, row.id, url, now);
      } catch (error) {
        this.logger.warn(
          `Copying the creative for ad ${row.externalId} in store ${scope.storeId} failed; ` +
            `left for the next sync: ${detailOf(error)}`,
        );
      }
    }
  }

  private async credentialFor(
    connectionId: string,
    scope: { orgId: string; storeId: string },
  ): Promise<StoreCredential> {
    const row = await this.credentials.findByStore(scope.orgId, scope.storeId);
    if (!row?.sealedSecret) {
      // The connection outlived its credential, which a disconnect mid-sync
      // does. There is nothing to ask the platform with, and inventing a
      // credential is not a thing that exists.
      throw new Error(
        `no credential is held for the store behind connection ${connectionId}`,
      );
    }
    return {
      providerRef: row.providerRef,
      providerKeyRef: row.providerKeyRef,
      secret: this.vault.open(row.sealedSecret),
    };
  }
}

/**
 * A failure as the merchant reads it.
 *
 * The adapter's own exceptions are already written for this audience — they say
 * that a rate limit is a limit on the integration rather than on the merchant's
 * account — so those are passed through. Everything else becomes one of two
 * sentences, because a database error or a parse failure is not something a
 * merchant can do anything with, and its text is not something to publish.
 */
function merchantMessage(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  if (error instanceof RangeError) return UNREADABLE_FIGURE;
  return GENERIC_FAILURE;
}

/**
 * One node per platform campaign. A campaign reported on two pages of a tree
 * that shifted while it was being read is kept once, with the later copy.
 */
function dedupeCampaigns(
  campaigns: readonly ReportedCampaign[],
): ReportedCampaign[] {
  const byId = new Map<string, ReportedCampaign>();
  for (const campaign of campaigns) {
    byId.set(campaign.externalCampaignId, campaign);
  }
  return [...byId.values()];
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'img';
  }
}

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
