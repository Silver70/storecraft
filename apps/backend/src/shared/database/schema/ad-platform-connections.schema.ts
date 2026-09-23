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
 * Where a connection has got to.
 *
 * `awaiting_account` is the middle of the flow made durable: the merchant has
 * approved on the platform's own screen, so we hold a grant, but no ad account
 * has been chosen for this Store yet. It is a row rather than a value held in
 * the browser because the choice can be refused — an ad account billed in
 * another currency than the Store's is offered and turned down — and a merchant
 * who closes the tab, or picks the wrong one, must not be sent back through
 * Meta's approval screen to try again.
 *
 * `disconnected` rather than deleted: figures already pulled belong to the
 * campaigns that connection produced, and revoking access must not rewrite a
 * past report. A disconnect stops the sync and destroys the credential; it
 * removes nothing.
 */
export const adPlatformConnectionStatusEnum = pgEnum(
  'ad_platform_connection_status',
  ['awaiting_account', 'connected', 'disconnected'],
);

export type AdPlatformConnectionStatus =
  (typeof adPlatformConnectionStatusEnum.enumValues)[number];

export const AD_PLATFORM_CONNECTION_LIMITS = {
  externalAccountId: 255,
  providerAccountRef: 255,
  accountName: 255,
  pixelId: 64,
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
 * `accountCurrency` is denormalized off the platform's ad account even though a
 * connected one always matches the Store's, because it is the fact the match
 * was checked against and it has to stay readable afterwards. The two are not
 * allowed to differ: an ad account billed in another currency is refused at
 * selection, in the picker and again server-side, so that no figure in this
 * feature is ever converted and no conversion logic exists anywhere (ADR-0006).
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
    /**
     * The provider's handle for the platform login the merchant approved.
     *
     * Not a secret and not an ad account: it is the thing every later call
     * names when it asks the provider to act against this grant — list the ad
     * accounts it can see, find or create a pixel, read the ad tree. It is
     * written the moment the merchant comes back from the platform, which is
     * before an ad account has been chosen, and that is why it is a column of
     * its own rather than something derived from `external_account_id`.
     */
    providerAccountRef: varchar('provider_account_ref', {
      length: AD_PLATFORM_CONNECTION_LIMITS.providerAccountRef,
    }),
    /**
     * The ad account id at the platform, as the platform spells it. Null only
     * while the merchant has approved but not yet chosen one.
     */
    externalAccountId: varchar('external_account_id', {
      length: AD_PLATFORM_CONNECTION_LIMITS.externalAccountId,
    }),
    /** What the merchant calls the account on the platform's own screen. */
    accountName: varchar('account_name', {
      length: AD_PLATFORM_CONNECTION_LIMITS.accountName,
    }),
    accountCurrency: varchar('account_currency', { length: 3 }),
    /**
     * The ad account's pixel, found at connection or created and named after
     * the Store.
     *
     * Here rather than on the Store because it belongs to the ad account: a
     * Store that reconnects to a different ad account gets that account's
     * pixel, and one that disconnects keeps the id beside the figures the
     * pixel's account produced. The storefront reads it from the public API so
     * that connecting Meta switches measurement on without a redeploy.
     */
    pixelId: varchar('pixel_id', {
      length: AD_PLATFORM_CONNECTION_LIMITS.pixelId,
    }),
    status: adPlatformConnectionStatusEnum('status')
      .notNull()
      .default('connected'),
    /**
     * When access was granted — the moment the ad account was chosen, not the
     * moment the merchant came back from the platform. A reconnect moves it; a
     * disconnect does not.
     */
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
