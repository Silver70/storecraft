import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

/**
 * The ad platforms a Store can be connected to.
 *
 * Also the vocabulary of `campaigns.platform`: a Campaign is always one on an
 * ad platform a Store can connect, and nothing else is a Campaign.
 *
 * Named for the platform the merchant approves on, never for the provider we
 * reach it through: the provider is one implementation of an interface and is
 * expected to be replaceable without a migration.
 */
export const adPlatformEnum = pgEnum('ad_platform', [
  'meta',
  'google',
  'tiktok',
  'linkedin',
  'pinterest',
  'x',
]);

export type AdPlatform = (typeof adPlatformEnum.enumValues)[number];

/**
 * Disconnected rather than deleted: figures already pulled belong to the
 * campaigns that connection produced, and revoking access must not rewrite a
 * past report. A
 * disconnect stops the sync and destroys the credential; it removes nothing.
 */
export const adPlatformConnectionStatusEnum = pgEnum(
  'ad_platform_connection_status',
  ['connected', 'disconnected'],
);

export type AdPlatformConnectionStatus =
  (typeof adPlatformConnectionStatusEnum.enumValues)[number];

export const AD_PLATFORM_CONNECTION_LIMITS = {
  externalAccountId: 255,
  accountName: 255,
  /** Wide enough for a sentence a merchant reads, narrow enough to stay one. */
  lastSyncError: 500,
} as const;

/**
 * One Store's connection to one ad platform — what the merchant sees on the
 * page, and what a later Reported Figure is attributed to.
 *
 * Scoped to the Store and not the Organization, so a US store and a UK store
 * each approve their own ad account and neither can read the other's.
 *
 * `accountCurrency` is denormalized off the platform's ad account rather than
 * read from the Store, because the two are allowed to differ and the
 * difference has to stay visible: ADR-0005 forbids converting one into the
 * other, so a figure in a foreign currency is stored as what it is and no ROAS
 * is computed across the mismatch.
 */
export const adPlatformConnections = pgTable(
  'ad_platform_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    platform: adPlatformEnum('platform').notNull(),
    /** The ad account id at the platform, as the platform spells it. */
    externalAccountId: varchar('external_account_id', {
      length: AD_PLATFORM_CONNECTION_LIMITS.externalAccountId,
    }).notNull(),
    /** What the merchant calls the account on the platform's own screen. */
    accountName: varchar('account_name', {
      length: AD_PLATFORM_CONNECTION_LIMITS.accountName,
    }),
    accountCurrency: varchar('account_currency', { length: 3 }),
    status: adPlatformConnectionStatusEnum('status')
      .notNull()
      .default('connected'),
    /** When access was last granted. A reconnect moves it; a disconnect does not. */
    connectedAt: timestamp('connected_at').notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at'),
    /**
     * When a sync last *succeeded*. Null means none ever has, which is how the
     * sync knows to backfill the history the platform offers rather than
     * starting from today.
     *
     * Shown to the merchant, and that is the reason it exists rather than being
     * derivable from the newest figure: a figure that stopped moving because
     * nothing was spent is indistinguishable from one that stopped moving
     * because the sync stopped running, and only this column tells them apart.
     * A stale figure has to be legibly stale.
     */
    lastSyncedAt: timestamp('last_synced_at'),
    /** When a sync last ran at all, successful or not. */
    lastSyncAttemptAt: timestamp('last_sync_attempt_at'),
    /**
     * Why the last attempt failed, in words a merchant can read, or null after
     * a success.
     *
     * Stored so the failure can be *shown* rather than thrown. A vendor outage
     * costs freshness, not the dashboard: every read path returns the figures
     * already pulled and this sentence beside them. The sentence must never
     * blame the merchant's own account — some upstream quotas are shared across
     * every customer of the provider and cannot be bought out of, so a refusal
     * frequently has nothing to do with this Organization.
     */
    lastSyncError: varchar('last_sync_error', {
      length: AD_PLATFORM_CONNECTION_LIMITS.lastSyncError,
    }),
    /** Consecutive failures, which is what widens the backoff below. */
    syncFailureCount: integer('sync_failure_count').notNull().default(0),
    /**
     * When the scheduled sync may next attempt this connection.
     *
     * Backing off rather than retrying hard is the whole of this column. A
     * refused call is usually a quota shared across the provider's entire
     * customer base, and hammering it neither restores service nor earns a
     * larger share of it. A merchant who presses Sync now is not a retry loop
     * and is never held by this.
     */
    syncPausedUntil: timestamp('sync_paused_until'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One connection per platform per Store, reconnected in place. A second row
    // would leave two candidates for a sync to write figures against, and
    // nothing to say which is current.
    unique('ad_platform_connections_store_platform_unique').on(
      t.storeId,
      t.platform,
    ),
    index('ad_platform_connections_org_store_status_idx').on(
      t.organizationId,
      t.storeId,
      t.status,
    ),
  ],
);

export type AdPlatformConnection = typeof adPlatformConnections.$inferSelect;
export type NewAdPlatformConnection = typeof adPlatformConnections.$inferInsert;
