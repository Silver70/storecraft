import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { campaigns, campaignStatusEnum } from './campaigns.schema';

export const AD_LIMITS = {
  name: 255,
  /**
   * Same width as the `utm_*` attribution columns it is joined against: the
   * platform writes this id into `utm_content` at the moment of the click.
   */
  externalId: 255,
} as const;

/** An Ad reports the same five statuses as its Campaign, for the same reason. */
export type AdStatus = (typeof campaignStatusEnum.enumValues)[number];

/**
 * How an Ad's creative is built, as the platform classifies it — the one thing
 * said about an Ad beside its name. Where the Ad was shown is deliberately not
 * carried: with automatic placements one Ad runs on every surface at once.
 */
export const adFormatEnum = pgEnum('ad_format', ['image', 'video', 'carousel']);

export type AdFormat = (typeof adFormatEnum.enumValues)[number];

/**
 * One creative running under a Campaign, keyed by the platform's own ad id.
 *
 * That id is what the Link Tags carry into an Order's Touch
 * (`utm_content={{ad.id}}`), so an Order finds its Ad by equality on this
 * column — and only among the Ads of the Campaign its Touch already named, so
 * an Ad can never claim a sale that belongs to a sibling Campaign.
 *
 * Unique per Store rather than per Campaign: a platform ad is one ad, and two
 * rows claiming it would count its revenue twice under two names.
 *
 * The Ad Set level is not modelled. A discovered Campaign's Ads are read as its
 * own whichever Ad Set they sit in.
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
    /** The platform's ad id — what `utm_content` carries on a click. */
    externalId: varchar('external_id', {
      length: AD_LIMITS.externalId,
    }).notNull(),
    name: varchar('name', { length: AD_LIMITS.name }).notNull(),
    /** Null where the platform has not said. */
    format: adFormatEnum('format'),
    /** As the platform reports it. Never written by a merchant here. */
    status: campaignStatusEnum('status').notNull(),
    /**
     * The picture the Ad is recognised by — its image, or a video's poster
     * frame. A copy in our own storage, since a platform's image links expire.
     */
    creativeUrl: text('creative_url'),
    /**
     * Whether this Ad's link carries our Link Tags. Absent by default: an Ad
     * built in the platform's own ad manager usually has none, and its revenue
     * cannot be measured until it does.
     */
    hasLinkTags: boolean('has_link_tags').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('ads_store_external_id_unique').on(t.storeId, t.externalId),
    index('ads_org_store_idx').on(t.organizationId, t.storeId),
    index('ads_campaign_idx').on(t.campaignId),
  ],
);

export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
