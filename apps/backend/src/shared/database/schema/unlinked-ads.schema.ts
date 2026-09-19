import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { ads } from './ads.schema';
import {
  adPlatformConnections,
  adPlatformEnum,
} from './ad-platform-connections.schema';

/**
 * What the merchant has decided about an ad the platform is spending on.
 *
 * An explicit state rather than a pair of nullable timestamps, for the reason
 * `orders.status` is one: claim and dismiss are decisions with rules about
 * which may follow which, and a state the database names is a state one
 * transition engine can be the only writer of. Two booleans would let a row be
 * both claimed and dismissed, and nothing would ever say so.
 *
 * - `pending` — the sync found it, nobody has decided anything. The only state
 *   a row is born in.
 * - `claimed` — resolved onto an Ad in this Store, which now carries its
 *   platform id and therefore its Reported Figures.
 * - `dismissed` — the merchant does not want it tracked. Durable: the next sync
 *   sees the row and leaves the decision alone.
 */
export const unlinkedAdStateEnum = pgEnum('unlinked_ad_state', [
  'pending',
  'claimed',
  'dismissed',
]);

export type UnlinkedAdState = (typeof unlinkedAdStateEnum.enumValues)[number];

export const UNLINKED_AD_LIMITS = {
  externalAdId: 255,
  name: 255,
} as const;

/**
 * An ad a platform is spending real money on that no Ad in this Store claims.
 *
 * **Nothing here is ever promoted to an Ad by a sync.** An Ad invented from a
 * platform's tree carries real cost and has no Ad Tag rule, so it could never
 * earn revenue — it would show spend against zero and read as the worst
 * performer in the account, auto-generating the most alarming card in the UI.
 * This table is what a sync writes instead: a held record, waiting for the one
 * decision only the merchant can make.
 *
 * Three decisions here are load-bearing:
 *
 * **The row is descriptive, not financial.** It carries what the merchant needs
 * to recognise the ad — its platform id, its name, its creative, its flight —
 * and no money at all. Spend to date is summed from `ad_reported_figures` on
 * the platform's ad id at read time, because those rows are the platform's book
 * and a second copy of a figure here would be a second thing to keep correct.
 *
 * **The state survives the sync.** `(connection_id, external_ad_id)` is unique,
 * so a sync that meets the same ad again updates what it looks like and never
 * what the merchant decided about it. That is the whole of "a dismissed ad does
 * not come back".
 *
 * **`claimed_ad_id` is a pointer, not the link.** What actually attaches this
 * ad's Reported Figures to an Ad is `ads.external_id` matching
 * `external_ad_id` — the join the figures table was keyed for, backfill
 * included. This column records which Ad the claim resolved onto so the
 * decision can be read back and undone; deleting it would not detach a figure,
 * and `on delete set null` says so: an Ad's disappearance leaves a resolved
 * decision, not a dangling one.
 */
export const unlinkedAds = pgTable(
  'unlinked_ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    /** The connection that saw it, which is also what says which ad account. */
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => adPlatformConnections.id, { onDelete: 'cascade' }),
    /** The source, on the row, for the reason a Reported Figure carries one. */
    platform: adPlatformEnum('platform').notNull(),
    /** The ad's id at the platform — the key its figures are already held under. */
    externalAdId: varchar('external_ad_id', {
      length: UNLINKED_AD_LIMITS.externalAdId,
    }).notNull(),
    /**
     * What the platform calls it. Nullable because some platforms report an ad
     * with no name, and a merchant recognising it by its creative alone is a
     * worse experience than a blank name but a better one than no row.
     */
    name: varchar('name', { length: UNLINKED_AD_LIMITS.name }),
    /** The picture the merchant recognises it by. A URL the platform hosts. */
    creativeUrl: text('creative_url'),
    /** When the platform says it ran. Either may be absent. */
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    state: unlinkedAdStateEnum('state').notNull().default('pending'),
    /** Which Ad the claim resolved onto, or null in every other state. */
    claimedAdId: uuid('claimed_ad_id').references(() => ads.id, {
      onDelete: 'set null',
    }),
    claimedAt: timestamp('claimed_at'),
    dismissedAt: timestamp('dismissed_at'),
    /** When a sync first held it — how long it has been waiting to be dealt with. */
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    /** When a sync last saw the platform still reporting it. */
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One row per platform ad per connection. The database is the authority on
    // that, not the read that preceded the write: a sync meets the same ad on
    // every run by design, and the conflict clause is what turns the second
    // meeting into a refresh of its name and creative rather than a second row
    // asking the merchant the same question again.
    unique('unlinked_ads_connection_ad_unique').on(
      t.connectionId,
      t.externalAdId,
    ),
    // The list the merchant reads, and the count surfaced beside it.
    index('unlinked_ads_org_store_state_idx').on(
      t.organizationId,
      t.storeId,
      t.state,
    ),
  ],
);

export type UnlinkedAd = typeof unlinkedAds.$inferSelect;
export type NewUnlinkedAd = typeof unlinkedAds.$inferInsert;
