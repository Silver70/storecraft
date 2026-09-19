import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  pgEnum,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { campaigns, campaignStatusEnum } from './campaigns.schema';

export const AD_LIMITS = {
  name: 255,
  /** Same width as the `utm_*` attribution columns the tag is matched against. */
  tag: 255,
  externalId: 255,
  /** Long enough for the longest label any platform prints, and no longer. */
  placement: 120,
} as const;

/**
 * An Ad shares the Campaign's status vocabulary because it shares the reason
 * for it: archived retires a finished creative from the active list, and there
 * is deliberately no deleted state, since revenue already reported against an
 * Ad would be silently re-bucketed by removing the row.
 */
export type AdStatus = (typeof campaignStatusEnum.enumValues)[number];

/**
 * The ad platform's own view of an ad, in the platform's own terms.
 *
 * A separate vocabulary from `AdStatus` because it is a separate fact, made by
 * somebody else: `active` and `archived` are what the merchant decided here,
 * and these five are what the platform decided there. Neither is a translation
 * of the other and neither may overwrite the other — an Ad that is active here
 * and `rejected` there is precisely the pairing this stage exists to show.
 *
 * Vendor-neutral, like everything above the adapter. A platform that spells
 * `in_review` "PENDING_REVIEW" is the adapter's problem and nobody else's.
 */
export const adPlatformStateEnum = pgEnum('ad_platform_state', [
  'approved',
  'rejected',
  'in_review',
  'delivering',
  'paused',
]);

export type AdPlatformState = (typeof adPlatformStateEnum.enumValues)[number];

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
    /**
     * The Ad's id on the ad platform.
     *
     * This is the reconciliation, not a note towards one: `ad_reported_figures`
     * is keyed on the platform's ad id, so setting this column is what attaches
     * every figure already pulled for that ad — backfill included — to this Ad.
     * Claiming an Unlinked Ad writes it; clearing it detaches the history
     * without deleting a single figure.
     */
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
    /**
     * **The merchant's status, and the only one a merchant writes.** A sync
     * never touches this column under any circumstance — see `platformState`
     * below for the reason, and `PlatformMirrorService` for the enforcement.
     */
    status: campaignStatusEnum('status').notNull().default('active'),
    /**
     * What the platform says about this ad, written only by the sync and null
     * for anything never synced.
     *
     * **It never overwrites `status`, and `status` never overwrites it.** They
     * are two independent facts displayed together: an ad the platform rejected
     * must not disappear from the merchant's active list along with its
     * history, and an ad the merchant archived here must not stop reporting
     * what the platform thinks of it. The whole payoff of the sync is the card
     * that reads "Active · rejected at the platform" — which exists only
     * because these are two columns.
     *
     * Null for every Ad on an `email`, `sms`, `affiliate` or `influencer`
     * campaign, and for every Ad whose platform ad nothing has claimed. That is
     * a designed state, not a missing one.
     */
    platformState: adPlatformStateEnum('platform_state'),
    /**
     * Where the platform ran the ad, as it names it — "Instagram Stories".
     *
     * **A recognition label only.** Nothing is reported by, filtered by or
     * grouped by this column, and nothing should be: one ad runs in several
     * placements at once, so treating it as a dimension is treating a
     * many-to-many as a single value, and the first report built that way would
     * split one ad's spend across placements it cannot split. Free text rather
     * than an enum for the same reason it is not a dimension — it exists to be
     * read, not matched — and deliberately unindexed.
     */
    placement: varchar('placement', { length: AD_LIMITS.placement }),
    /**
     * When the platform last said either of the two things above.
     *
     * Both are **preserved, not cleared,** when a platform stops reporting an
     * ad: an ad leaves a tree for reasons that are not facts about the ad — it
     * fell outside the window asked for, a quota refusal truncated the answer,
     * the account was disconnected — so clearing would flicker the card against
     * the sync's luck. This column is what keeps that honest, by dating the
     * claim so a stale `rejected` reads as stale rather than as current.
     *
     * Cleared, with both fields, only when the Ad stops claiming a platform ad
     * at all.
     */
    platformReportedAt: timestamp('platform_reported_at'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The database is the authority on tag uniqueness, not the read that
    // preceded the insert — two admins naming an ad the same thing at the same
    // moment must not both win. Scoped to the Campaign, not the Store.
    unique('ads_campaign_tag_unique').on(t.campaignId, t.tag),
    // At most one Ad in a Store may claim a given platform ad. Two would both
    // match the same rows in `ad_reported_figures` and the same spend would be
    // reported twice under two names, with nothing in the data saying which was
    // meant. Scoped to the Store rather than the Campaign, unlike the tag: a
    // platform ad is one ad, whichever push a merchant decides it belongs to.
    // Partial, because most Ads have no platform id and all of them are free to
    // have none.
    uniqueIndex('ads_store_external_id_unique')
      .on(t.storeId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('ads_org_store_status_idx').on(t.organizationId, t.storeId, t.status),
    index('ads_campaign_status_idx').on(t.campaignId, t.status),
  ],
);

export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
