import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { campaigns, campaignStatusEnum } from './campaigns.schema';

export const AD_LIMITS = {
  name: 255,
  /** Same width as the `utm_*` attribution columns the tag is matched against. */
  tag: 255,
  externalId: 255,
} as const;

/**
 * An Ad shares the Campaign's status vocabulary because it shares the reason
 * for it: archived retires a finished creative from the active list, and there
 * is deliberately no deleted state, since revenue already reported against an
 * Ad would be silently re-bucketed by removing the row.
 */
export type AdStatus = (typeof campaignStatusEnum.enumValues)[number];

/**
 * One creative running under a Campaign — the thing a visitor actually sees.
 *
 * A Campaign is what gets funded; an Ad is what runs. A Campaign may have none:
 * an Ad is a subdivision a merchant opts into, never a wrapper invented around a
 * Campaign that has one.
 *
 * Two decisions here are load-bearing:
 *
 * The unique constraint is on `(campaign_id, tag)` and **not** on
 * `(store_id, tag)`. Two Campaigns are each free to own an Ad tagged `video-a`,
 * which is the thing merchants actually do. That is only safe because an Ad is
 * resolved in a second pass over its own Campaign's Ads (ADR-0004) and can
 * therefore never claim a sale belonging to a sibling Campaign.
 *
 * There is no `platform`. An Ad inherits its Campaign's, because funding is per
 * ad account and ADR-0002 already put platform there.
 */
export const ads = pgTable(
  'ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: AD_LIMITS.name }).notNull(),
    /**
     * The canonical `utm_content` value for this Ad — a slug derived from the
     * name at creation by the same derivation the Campaign Tag uses, so both
     * sides of a later comparison normalize identically.
     *
     * Fixed at creation and unchanged by a rename, for the reason the Campaign
     * Tag is: a link already running in an ad platform cannot be recalled.
     */
    tag: varchar('tag', { length: AD_LIMITS.tag }).notNull(),
    /** The Ad's id on the ad platform, for a later reconciliation. */
    externalId: varchar('external_id', { length: AD_LIMITS.externalId }),
    /**
     * The creative — the picture a merchant recognises the Ad by, since nobody
     * recognises a slug.
     *
     * Nullable, and expected to stay null for a long time: a Campaign on
     * `email`, `sms`, `affiliate`, `influencer` or `other` has no creative to
     * show and never will, so the empty state is a designed state rather than
     * an unfinished one.
     *
     * A URL rather than a storage key, and a single column rather than a
     * reference to a media table, because the platform sync fills exactly this
     * column with a URL it does not host for us. An upload writes the public URL
     * of the object it just stored; a sync writes the platform's. Neither needs
     * to know which wrote it last.
     */
    creativeUrl: text('creative_url'),
    /**
     * When the creative ran. Both are optional and either may be set alone — a
     * merchant often knows when a test started and not when it will stop.
     * Nothing is enforced against them beyond start preceding end; they exist so
     * a three-day test is not compared naively against a month-long evergreen.
     */
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    status: campaignStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The database is the authority on tag uniqueness, not the read that
    // preceded the insert — two admins naming an ad the same thing at the same
    // moment must not both win. Scoped to the Campaign, not the Store.
    unique('ads_campaign_tag_unique').on(t.campaignId, t.tag),
    index('ads_org_store_status_idx').on(t.organizationId, t.storeId, t.status),
    index('ads_campaign_status_idx').on(t.campaignId, t.status),
  ],
);

export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
