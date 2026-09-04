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
 * Where the merchant is spending the money this Campaign represents.
 *
 * A closed set so the value means the same thing to the reports and to a later
 * ad-platform reconciliation, with `other` as the escape hatch. Adding a
 * platform is one `ALTER TYPE campaign_platform ADD VALUE` in a migration.
 */
export const campaignPlatformEnum = pgEnum('campaign_platform', [
  'meta',
  'google',
  'tiktok',
  'instagram',
  'youtube',
  'x',
  'linkedin',
  'pinterest',
  'email',
  'sms',
  'affiliate',
  'influencer',
  'other',
]);

export type CampaignPlatform = (typeof campaignPlatformEnum.enumValues)[number];

/**
 * Archived keeps a finished Campaign out of the active list without losing the
 * history it explains. There is deliberately no deleted state: attribution is
 * resolved from a Campaign's rules at read time, so removing a row would silently
 * re-bucket revenue that has already been reported.
 */
export const campaignStatusEnum = pgEnum('campaign_status', [
  'active',
  'archived',
]);

export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];

export const CAMPAIGN_LIMITS = {
  name: 255,
  /** Same width as the `utm_*` attribution columns the tag is matched against. */
  tag: 255,
  externalId: 255,
} as const;

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
    name: varchar('name', { length: CAMPAIGN_LIMITS.name }).notNull(),
    /**
     * The canonical `utm_campaign` value for this Campaign — a slug derived from
     * the name at creation and unique within the Store. Links generated from the
     * Campaign carry it, and the Campaign's canonical matching rule matches it,
     * so a generated link is attributed by construction.
     *
     * It is fixed at creation and survives a rename: a tag already pasted into an
     * ad platform cannot be recalled, so changing it would orphan live ads.
     */
    tag: varchar('tag', { length: CAMPAIGN_LIMITS.tag }).notNull(),
    platform: campaignPlatformEnum('platform').notNull(),
    /** The Campaign's id on the ad platform, for a later reconciliation. */
    externalId: varchar('external_id', { length: CAMPAIGN_LIMITS.externalId }),
    status: campaignStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The database is the authority on tag uniqueness, not the read that
    // preceded the insert — two admins naming a campaign the same thing at the
    // same moment must not both win.
    unique('campaigns_store_tag_unique').on(t.storeId, t.tag),
    index('campaigns_org_store_status_idx').on(
      t.organizationId,
      t.storeId,
      t.status,
    ),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
