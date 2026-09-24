import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  integer,
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
 * and schedule. The adapter translates the vendor's spellings of them at the
 * edge, and the collapse onto this set happens once, in
 * `ad-platform/utils/platform-status.util.ts`, so nothing reads a vendor's
 * vocabulary and no two places can disagree about precedence.
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
 * Where a Campaign's budget lives at the platform.
 *
 * `campaign` is one budget for the whole Campaign, which every Campaign created
 * here has. `ad_set` is a budget per Ad Set, which only a Campaign built in Ads
 * Manager can have. Its budget cannot be edited here: there is no single number
 * to show, and the Ad Set is not modelled.
 */
export const campaignBudgetLevelEnum = pgEnum('campaign_budget_level', [
  'campaign',
  'ad_set',
]);

export type CampaignBudgetLevel =
  (typeof campaignBudgetLevelEnum.enumValues)[number];

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
  creationKey: 255,
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
     * Where the budget lives at the platform, as the platform last said. Null
     * until a sync or a create has said.
     */
    budgetLevel: campaignBudgetLevelEnum('budget_level'),
    /**
     * The Campaign's daily budget, in minor units of the Store's currency, as
     * the platform holds it. Null when the budget is not one daily figure on
     * the Campaign: a budget per Ad Set, or a lifetime budget. Either one is
     * changed in Ads Manager, not here.
     *
     * The platform's cap, not what it spent. Spend is in `ad_daily_figures`.
     */
    dailyBudget: integer('daily_budget'),
    /**
     * Whether every Ad under this Campaign carries our Link Tags — Tracked when
     * true, Not Tracked when false. Absent until shown otherwise: a Campaign
     * whose revenue we cannot see must read as unknown, never as zero.
     */
    hasLinkTags: boolean('has_link_tags').notNull().default(false),
    /**
     * The idempotency key of the create that made this Campaign here, or null
     * for one the sync discovered. A retried create finds its campaign by this
     * key and answers with it, rather than asking the platform to build another.
     */
    creationKey: varchar('creation_key', {
      length: CAMPAIGN_LIMITS.creationKey,
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One row per platform campaign per Store. The database is the authority,
    // so a sync and a create racing on the same campaign cannot both insert.
    unique('campaigns_store_external_id_unique').on(t.storeId, t.externalId),
    // One campaign per create, even when two retries race each other here.
    unique('campaigns_store_creation_key_unique').on(t.storeId, t.creationKey),
    index('campaigns_org_store_status_idx').on(
      t.organizationId,
      t.storeId,
      t.status,
    ),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
