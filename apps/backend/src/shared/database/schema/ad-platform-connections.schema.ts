import {
  pgTable,
  uuid,
  varchar,
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
 * A deliberate subset of `campaign_platform`, using the same spellings: every
 * value here is a platform that reports an ad tree we can mirror. `email`,
 * `sms`, `affiliate` and `influencer` are absent because nothing can be pulled
 * from them, and a Campaign on one of those stays hand-costed permanently —
 * which is why manual Spend entry is a first-class path and not a legacy one.
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
 * Disconnected rather than deleted, for the reason a Campaign is archived
 * rather than deleted: figures already pulled point at the connection that
 * produced them, and revoking access must not rewrite a past report. A
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
