import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { adPlatformEnum } from './ad-platform-connections.schema';

/**
 * What the platform says a Campaign or an Ad is doing, collapsed to the five
 * answers a merchant acts on.
 *
 * **Read from the platform and never decided here.** There is no merchant-owned
 * status: a Campaign is the platform's campaign, so the only way to change what
 * it is doing is to ask the platform to, and the next sync reports the answer.
 * The platform describes a campaign on three separate axes — delivery, review
 * and schedule — and the collapse from those onto this set happens once, at the
 * adapter edge, so nothing above it ever reads a vendor's spelling.
 *
 * `ended` covers a finished schedule and a campaign deleted on the platform
 * alike. Neither is hidden: an ended campaign spent money, and its history has
 * to stay readable.
 */
export const campaignStatusEnum = pgEnum('campaign_status', [
  'active',
  'paused',
  'in_review',
  'needs_attention',
  'ended',
]);

export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];

/**
 * The platforms a Campaign can live on — exactly the ones a Store can connect,
 * and the same enum, so a Campaign can never name a platform there is no
 * connection for. Email, SMS, affiliate and influencer are not Campaigns at all
 * (ADR-0006): their Touches are still kept on every Order, but nothing reports
 * on them.
 */
export type CampaignPlatform = (typeof adPlatformEnum.enumValues)[number];

export const CAMPAIGN_LIMITS = {
  name: 255,
  /**
   * Same width as the `utm_*` attribution columns it is joined against: the
   * platform writes this id into `utm_campaign` at the moment of the click.
   */
  externalId: 255,
} as const;

/**
 * One campaign on an ad platform, in the ad account a Store has connected.
 *
 * Keyed by the platform's own campaign id, unique per Store. That id is what
 * the Link Tags carry into an Order's Touch (`utm_campaign={{campaign.id}}`), so
 * the join from an Order to its Campaign is an equality on this column — no
 * tag, no matching rule, no normalization. A rename changes `name` and nothing
 * that reporting depends on.
 *
 * Born one of two ways, created here and pushed to the platform or discovered
 * by the sync, and the same row either way.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    platform: adPlatformEnum('platform').notNull(),
    /** The platform's campaign id — what `utm_campaign` carries on a click. */
    externalId: varchar('external_id', {
      length: CAMPAIGN_LIMITS.externalId,
    }).notNull(),
    name: varchar('name', { length: CAMPAIGN_LIMITS.name }).notNull(),
    /** As the platform reports it. See `campaignStatusEnum`. */
    status: campaignStatusEnum('status').notNull(),
    /**
     * The schedule the platform holds. Either may be absent — a campaign still
     * delivering routinely has a start and no end.
     */
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    /**
     * The image the Campaign is recognised by. A platform campaign has none of
     * its own, so this starts as one of its Ads' Creatives; a copy in our own
     * storage, since a platform's image links expire.
     */
    coverUrl: text('cover_url'),
    /**
     * Whether every Ad under this Campaign carries our Link Tags — Tracked when
     * true, Not Tracked when false. Absent until shown otherwise: a Campaign
     * whose revenue we cannot see must read as unknown, never as zero.
     */
    hasLinkTags: boolean('has_link_tags').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One row per platform campaign per Store. The database is the authority,
    // so a sync and a create racing on the same campaign cannot both insert.
    unique('campaigns_store_external_id_unique').on(t.storeId, t.externalId),
    index('campaigns_org_store_status_idx').on(
      t.organizationId,
      t.storeId,
      t.status,
    ),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
