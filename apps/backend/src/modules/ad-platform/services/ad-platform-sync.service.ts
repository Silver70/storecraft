import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AdPlatform } from '../../../shared/database/schema';
import { dayInTimezone } from '../../marketing/utils/spend-day.util';
import {
  AD_PLATFORM_PROVIDER,
  type AdPlatformProvider,
  type AdTree,
} from '../interfaces/ad-platform-provider.interface';
import {
  AdPlatformConnectionRepository,
  type ConnectionToSync,
} from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import {
  AdReportedFigureRepository,
  type ReportedFigureRow,
} from '../repositories/ad-reported-figure.repository';
import {
  SyncedSpendService,
  type PlatformSpendDay,
} from '../../marketing/services/synced-spend.service';
import { CredentialVault } from './credential-vault.service';
import { UnlinkedAdService } from './unlinked-ad.service';
import type { PlatformAdSighting } from '../utils/unlinked-ad-plan.util';
import {
  DEFAULT_BACKFILL_DAYS,
  backoffUntil,
  syncWindow,
} from '../utils/sync-window.util';

/** What one connection's sync did, in the terms the merchant is shown. */
export interface SyncOutcome {
  platform: AdPlatform;
  status: 'synced' | 'failed';
  /** Inclusive `YYYY-MM-DD` range that was asked for. */
  from: string;
  to: string;
  /** Whether this was a first connection's backfill. */
  backfill: boolean;
  /** How many platform ad-days were written or corrected. */
  figuresWritten: number;
  /**
   * How many days of Spend were written into the merchant's own book, against
   * the Ads that claim the platform's ads.
   *
   * A different number from `figuresWritten` and deliberately so: that one
   * counts every ad the platform reported, this one counts only the days that
   * landed on a claimed Ad in a matching currency and were not pinned.
   */
  spendWritten: number;
  /**
   * How many days the sync left alone because the merchant pinned them.
   *
   * **Recorded, not failed.** This is the number that makes the pin visible:
   * a merchant who reconciled a day against their invoice can see that the
   * sync met it and stood down, rather than wondering whether it ever ran.
   */
  spendDeclined: number;
  /**
   * The ad account's currency and the Store's, when they differ — in which case
   * no Spend was written at all.
   *
   * The Reported Figures are still pulled and still readable in the currency
   * they are in. What is refused is dropping them into a book that is summed as
   * a single currency, because there is no conversion anywhere here (ADR-0005)
   * and the merchant is owed the mismatch rather than a total built on a rate
   * nobody chose.
   */
  spendCurrencyMismatch: { store: string; account: string } | null;
  /**
   * How many of the platform's ads nothing in this Store claims, and are
   * therefore being held for the merchant to decide about.
   *
   * **Not a count of Ads created.** No sync creates one: an Ad invented from a
   * platform's tree carries real cost and has no Ad Tag rule, so it would show
   * spend against zero revenue and read as the worst performer in the account.
   */
  unlinkedHeld: number;
  /**
   * Why it failed, in words a merchant can act on, or null on success. Never a
   * stack trace, and never a sentence that blames their own account.
   */
  message: string | null;
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
  'The ad platform could not be reached for this store just now. The figures already pulled are unchanged, and the sync will try again shortly.';

const UNREADABLE_FIGURE =
  'The ad platform returned figures that could not be read. Nothing already pulled has changed, and the sync will try again shortly.';

/**
 * Pulls what the ad platform knows, on a schedule and on demand.
 *
 * ## What this service is allowed to write
 *
 * `ad_reported_figures`, the sync state on the connection that produced them,
 * and — through `SyncedSpendService` and nothing else — the **spend** side of
 * `campaign_spend`.
 *
 * That last one is a narrow door, and the narrowness is the point. What an ad
 * account was charged is the same fact the merchant would otherwise read off
 * the platform's dashboard and type in by hand, so it belongs in their book of
 * record, labelled `synced` and never overwriting a day they pinned. The
 * platform's **revenue, conversions and ROAS do not follow it**: those are
 * claims made on an attribution window that is not ours, they stay in
 * `ad_reported_figures` where they are labelled and displayed beside ours, and
 * they are never an input to Contribution Margin (ADR-0005). The two books are
 * allowed to disagree — which they routinely will, by a factor of two — and
 * showing both is the whole point.
 *
 * Nothing here touches `CampaignSpendRepository` directly, and nothing here
 * writes a Campaign-level Spend row: a sync knows which creative spent the
 * money, and a row naming no Ad is a statement only a merchant can make.
 *
 * ## Why nothing here throws at a merchant
 *
 * Every public method returns an outcome rather than raising. A vendor outage
 * costs freshness, not the dashboard: the figures already pulled stay readable
 * through a failed sync, the failure is recorded on the connection, and the
 * page shows both. The scheduled job has no one to throw to in the first place.
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
    private readonly figures: AdReportedFigureRepository,
    private readonly unlinked: UnlinkedAdService,
    private readonly syncedSpend: SyncedSpendService,
    private readonly vault: CredentialVault,
  ) {}

  /**
   * Every connected Store, four times a day.
   *
   * Six-hourly rather than nightly because a merchant watching a campaign wants
   * today's cost today, and rather than five-minutely because the figures are
   * daily totals that a platform restates for days afterwards — polling harder
   * would spend a shared quota to re-read the same numbers.
   *
   * This is a one-line delegation on purpose: the schedule is the framework's,
   * the work is `syncAllConnections`, and everything worth testing is in the
   * method rather than in the decorator.
   */
  @Cron('0 */6 * * *')
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
   * A sync the merchant asked for, for one Store.
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
   * One connection: ask the platform what it knows, write it down, record how
   * it went.
   *
   * The whole method is inside a try, and the catch is the feature: whatever
   * goes wrong — the vendor being down, a quota refusal, a payload that cannot
   * be read as money — becomes a recorded failure and a sentence, not an
   * exception travelling up into whatever asked for the sync.
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

      const tree = await this.provider.fetchAdTree({
        credential,
        platform: connection.platform,
        externalAccountId: connection.externalAccountId,
        from: window.from,
        to: window.to,
      });

      const rows = this.rowsFrom(tree, target, window.from, window.to);
      const written = await this.figures.upsertMany(rows, now);

      // After the figures and never instead of them. Holding an ad is the
      // merchant's prompt; the figures are the money, and the money is recorded
      // whether or not anyone ever answers the prompt.
      const { held } = await this.unlinked.recordSighting(
        {
          orgId: connection.organizationId,
          storeId: connection.storeId,
          connectionId: connection.id,
          platform: connection.platform,
        },
        sightingsFrom(tree),
        now,
      );

      // And last, the merchant's own book — only for the ads an Ad here claims,
      // only in the Store's own currency, and never over a day they pinned.
      // Last because everything before it is recorded regardless of what this
      // does: the platform's figures are pulled and the unclaimed ads are held
      // whether or not a single Spend row could be written.
      const spend = await this.syncedSpend.apply(
        {
          organizationId: connection.organizationId,
          storeId: connection.storeId,
          currency: tree.currency,
          days: spendDaysFrom(tree, window.from, window.to),
        },
        now,
      );

      await this.connections.recordSyncSuccess(connection.id, now);

      this.logger.log(
        `Synced ${connection.platform} for store ${connection.storeId}: ` +
          `${written} figure(s) over ${window.from}…${window.to}` +
          (window.backfill ? ' (backfill)' : '') +
          `, ${spend.written} spend day(s) recorded` +
          (spend.declinedPinned
            ? `, ${spend.declinedPinned} pinned day(s) left alone`
            : ''),
      );

      return {
        platform: connection.platform,
        status: 'synced',
        from: window.from,
        to: window.to,
        backfill: window.backfill,
        figuresWritten: written,
        spendWritten: spend.written,
        spendDeclined: spend.declinedPinned,
        spendCurrencyMismatch: spend.currencyMismatch,
        unlinkedHeld: held,
        message: null,
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
        figuresWritten: 0,
        spendWritten: 0,
        spendDeclined: 0,
        spendCurrencyMismatch: null,
        unlinkedHeld: 0,
        message,
      };
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async credentialFor(
    connectionId: string,
    scope: { orgId: string; storeId: string },
  ): Promise<{ providerRef: string; secret: string }> {
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
      secret: this.vault.open(row.sealedSecret),
    };
  }

  /**
   * The platform's tree as rows, scoped to the Organization and Store that
   * asked for it.
   *
   * Two things happen here and nothing else does. Every row carries its own
   * `organization_id` and `store_id`, copied from the connection rather than
   * from anything the provider said, so a provider that returned another
   * tenant's ad could not write into their figures. And the currency is the ad
   * account's, stored as what it is: no rate is fetched, inferred or
   * hard-coded, and a figure in a currency the Store does not use is still that
   * currency's figure (ADR-0005).
   */
  private rowsFrom(
    tree: AdTree,
    target: ConnectionToSync,
    from: string,
    to: string,
  ): ReportedFigureRow[] {
    const { connection } = target;
    const rows: ReportedFigureRow[] = [];

    for (const ad of tree.ads) {
      for (const day of ad.days) {
        // A day outside the range we asked for is dropped rather than stored:
        // no later sync's window would cover it, so it would be written once
        // and never confirmed again — a figure that silently stops being
        // refreshed is worse than one that was never shown.
        if (day.day < from || day.day > to) continue;

        rows.push({
          organizationId: connection.organizationId,
          storeId: connection.storeId,
          connectionId: connection.id,
          platform: connection.platform,
          externalAdId: ad.externalAdId,
          day: day.day,
          spend: day.spend,
          impressions: day.impressions,
          clicks: day.clicks,
          conversions: day.conversions,
          reportedRevenue: day.reportedRevenue,
          reportedRoasBp: day.reportedRoasBp,
          currency: tree.currency,
        });
      }
    }

    return rows;
  }
}

/**
 * The tree as spend per platform ad per day, inside the window that was asked
 * for.
 *
 * The same window filter `rowsFrom` applies, and for the same reason: a day
 * outside the range no later sync will cover is a figure that would be written
 * once and never confirmed again. Only spend is carried across — the revenue,
 * conversions and ROAS beside it in the tree stay in the platform's own book.
 */
function spendDaysFrom(
  tree: AdTree,
  from: string,
  to: string,
): PlatformSpendDay[] {
  const days: PlatformSpendDay[] = [];
  for (const ad of tree.ads) {
    for (const day of ad.days) {
      if (day.day < from || day.day > to) continue;
      days.push({
        externalAdId: ad.externalAdId,
        day: day.day,
        amount: day.spend,
      });
    }
  }
  return days;
}

/**
 * The tree as descriptions of ads, with no figures on them.
 *
 * What an Unlinked Ad is held with: the name, the creative and the flight are
 * how a merchant recognises which of their ads this is, and a platform ad id
 * recognises nothing. The money stays in `ad_reported_figures`, where it is
 * summed on read — one place holds a figure, and it is the platform's book.
 */
function sightingsFrom(tree: AdTree): PlatformAdSighting[] {
  return tree.ads.map((ad) => ({
    externalAdId: ad.externalAdId,
    name: ad.name,
    creativeUrl: ad.creativeUrl,
    startsAt: ad.startsAt,
    endsAt: ad.endsAt,
  }));
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

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
