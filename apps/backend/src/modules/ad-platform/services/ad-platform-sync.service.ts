import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AdPlatform } from '../../../shared/database/schema';
import {
  AD_PLATFORM_PROVIDER,
  type AdPlatformProvider,
  type StoreCredential,
} from '../interfaces/ad-platform-provider.interface';
import {
  AdPlatformConnectionRepository,
  type ConnectionToSync,
} from '../repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from '../repositories/ad-platform-credential.repository';
import { CredentialVault } from './credential-vault.service';
import {
  DEFAULT_BACKFILL_DAYS,
  backoffUntil,
  dayInTimezone,
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
  'The ad platform could not be reached for this store just now. Nothing already recorded has changed, and the sync will try again shortly.';

const UNREADABLE_FIGURE =
  'The ad platform returned figures that could not be read. Nothing already recorded has changed, and the sync will try again shortly.';

/**
 * Pulls what the ad platform knows, on a schedule and on demand.
 *
 * ## What this service is allowed to write
 *
 * The sync state on the connection it ran for, and nothing else — yet. It reads
 * the ad tree over the window a sync owes and records how that went. Writing
 * what it read — the Campaigns and Ads it finds, keyed by the platform's own
 * ids, and each Ad's daily spend, impressions and clicks into
 * `ad_daily_figures` — is this service's next job, and nothing else will ever
 * write those.
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
  ) {}

  /**
   * Every connected Store, four times a day.
   *
   * Six-hourly rather than nightly because a merchant watching a campaign wants
   * today's figures today, and rather than five-minutely because they are daily
   * totals that a platform restates for days afterwards — polling harder would
   * spend a shared quota to re-read the same numbers.
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

      // Read, and not yet written anywhere: turning the tree into Campaigns,
      // Ads and daily figures is the sync's next job. Asking now keeps the
      // window, the backfill and the failure handling exercised end to end.
      await this.provider.fetchAdTree({
        credential,
        platform: connection.platform,
        providerAccountRef: connection.providerAccountRef,
        externalAccountId: connection.externalAccountId,
        from: window.from,
        to: window.to,
      });

      await this.connections.recordSyncSuccess(connection.id, now);

      this.logger.log(
        `Synced ${connection.platform} for store ${connection.storeId} over ` +
          `${window.from}…${window.to}` +
          (window.backfill ? ' (backfill)' : ''),
      );

      return {
        platform: connection.platform,
        status: 'synced',
        from: window.from,
        to: window.to,
        backfill: window.backfill,
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
        message,
      };
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

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

function detailOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
