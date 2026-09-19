import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { adPlatformConnections, stores } from '../../../shared/database/schema';
import type {
  AdPlatform,
  AdPlatformConnection,
} from '../../../shared/database/schema';
import { AD_PLATFORM_CONNECTION_LIMITS } from '../../../shared/database/schema';

/**
 * A connection the sync is about to run, with the one thing about its Store the
 * sync needs.
 *
 * The timezone travels with the connection because a Reported Figure's day has
 * to be the merchant's day — the same day their Spend is recorded against, and
 * the day the platform is reporting. Reading it separately per connection would
 * be a query per Store inside a loop over every Store.
 */
export interface ConnectionToSync {
  connection: AdPlatformConnection;
  storeTimezone: string;
}

export interface UpsertConnectionInput {
  externalAccountId: string;
  accountName: string | null;
  accountCurrency: string | null;
}

/**
 * Every method takes the organization and the store explicitly and filters on
 * both. A connection id from another tenant reads as "not found", never as
 * someone else's ad account.
 */
@Injectable()
export class AdPlatformConnectionRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findMany(
    orgId: string,
    storeId: string,
  ): Promise<AdPlatformConnection[]> {
    return this.db
      .select()
      .from(adPlatformConnections)
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
        ),
      )
      .orderBy(asc(adPlatformConnections.createdAt));
  }

  async findByPlatform(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<AdPlatformConnection | null> {
    const [row] = await this.db
      .select()
      .from(adPlatformConnections)
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.platform, platform),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Records what the merchant approved, reconnecting in place if this Store has
   * connected this platform before.
   *
   * Reconnecting moves `connectedAt` and clears `disconnectedAt`, because the
   * merchant is being told when access was last granted. Nothing else about the
   * row is reset: it keeps its id, which is what figures already pulled point
   * at, so a reconnect cannot orphan a past report.
   */
  async upsertConnected(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
    input: UpsertConnectionInput,
  ): Promise<AdPlatformConnection> {
    const now = new Date();
    const [row] = await this.db
      .insert(adPlatformConnections)
      .values({
        organizationId: orgId,
        storeId,
        platform,
        externalAccountId: input.externalAccountId,
        accountName: input.accountName,
        accountCurrency: input.accountCurrency,
        status: 'connected',
        connectedAt: now,
      })
      .onConflictDoUpdate({
        target: [adPlatformConnections.storeId, adPlatformConnections.platform],
        set: {
          externalAccountId: input.externalAccountId,
          accountName: input.accountName,
          accountCurrency: input.accountCurrency,
          status: 'connected',
          connectedAt: now,
          disconnectedAt: null,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /**
   * Stops the connection without removing it. A deleted row would take the
   * figures pointing at it with it, and revoking access must not rewrite a past
   * report.
   */
  async markDisconnected(
    orgId: string,
    storeId: string,
    platform: AdPlatform,
  ): Promise<AdPlatformConnection | null> {
    const now = new Date();
    const [row] = await this.db
      .update(adPlatformConnections)
      .set({ status: 'disconnected', disconnectedAt: now, updatedAt: now })
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.platform, platform),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Whether any platform other than `excluding` still holds this Store's
   * credential open. The answer decides whether the credential is destroyed.
   */
  async hasOtherConnected(
    orgId: string,
    storeId: string,
    excluding: AdPlatform,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: adPlatformConnections.id })
      .from(adPlatformConnections)
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.status, 'connected'),
          ne(adPlatformConnections.platform, excluding),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Every connected connection the schedule should attempt now, across all
   * tenants, oldest-synced first.
   *
   * Cross-tenant on purpose and only here: a scheduled job has no request and
   * therefore no Organization, exactly as the analytics rollup has none. Each
   * connection carries its own `organization_id` into everything the sync
   * writes, so the tenancy guarantee is kept by the rows rather than by the
   * query that found them.
   *
   * A connection in backoff is skipped rather than retried. A merchant pressing
   * Sync now does not come through here and is never held by it.
   */
  async findDueForSync(now: Date): Promise<ConnectionToSync[]> {
    const rows = await this.db
      .select({
        connection: adPlatformConnections,
        storeTimezone: stores.timezone,
      })
      .from(adPlatformConnections)
      .innerJoin(stores, eq(stores.id, adPlatformConnections.storeId))
      .where(
        and(
          eq(adPlatformConnections.status, 'connected'),
          isNull(stores.deletedAt),
          or(
            isNull(adPlatformConnections.syncPausedUntil),
            lte(adPlatformConnections.syncPausedUntil, now),
          ),
        ),
      )
      // Never-synced first: a connection made this morning is the one whose
      // merchant is watching an empty page waiting for its backfill.
      .orderBy(
        asc(adPlatformConnections.lastSyncedAt),
        asc(adPlatformConnections.createdAt),
      );

    return rows;
  }

  /**
   * One Store's connected connections, with the Store's timezone, for a sync a
   * merchant asked for by hand.
   */
  async findConnectedForStore(
    orgId: string,
    storeId: string,
    platform?: AdPlatform,
  ): Promise<ConnectionToSync[]> {
    return this.db
      .select({
        connection: adPlatformConnections,
        storeTimezone: stores.timezone,
      })
      .from(adPlatformConnections)
      .innerJoin(stores, eq(stores.id, adPlatformConnections.storeId))
      .where(
        and(
          eq(adPlatformConnections.organizationId, orgId),
          eq(adPlatformConnections.storeId, storeId),
          eq(adPlatformConnections.status, 'connected'),
          ...(platform ? [eq(adPlatformConnections.platform, platform)] : []),
        ),
      )
      .orderBy(asc(adPlatformConnections.createdAt));
  }

  /**
   * Records a sync that worked: when it last succeeded, and the end of any
   * failure that preceded it.
   *
   * Clearing the error and the backoff together is the point — a connection
   * that recovered must not keep showing a merchant a failure it no longer
   * has, and must not stay held out of the schedule for one.
   */
  async recordSyncSuccess(connectionId: string, at: Date): Promise<void> {
    await this.db
      .update(adPlatformConnections)
      .set({
        lastSyncedAt: at,
        lastSyncAttemptAt: at,
        lastSyncError: null,
        syncFailureCount: 0,
        syncPausedUntil: null,
        updatedAt: at,
      })
      .where(eq(adPlatformConnections.id, connectionId));
  }

  /**
   * Records a sync that failed, without touching `lastSyncedAt`.
   *
   * That column keeps pointing at the last success, which is what makes a stale
   * figure legibly stale: the merchant sees figures from Tuesday, a note saying
   * the sync has been failing since Wednesday, and nothing in between pretending
   * to be current. Nothing already pulled is altered or removed.
   */
  async recordSyncFailure(
    connectionId: string,
    at: Date,
    message: string,
    pausedUntil: Date,
  ): Promise<void> {
    await this.db
      .update(adPlatformConnections)
      .set({
        lastSyncAttemptAt: at,
        lastSyncError: message.slice(
          0,
          AD_PLATFORM_CONNECTION_LIMITS.lastSyncError,
        ),
        syncFailureCount: sql`${adPlatformConnections.syncFailureCount} + 1`,
        syncPausedUntil: pausedUntil,
        updatedAt: at,
      })
      .where(eq(adPlatformConnections.id, connectionId));
  }
}
