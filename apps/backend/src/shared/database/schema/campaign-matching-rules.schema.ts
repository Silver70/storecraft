import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { campaigns } from './campaigns.schema';
import { ads } from './ads.schema';

/**
 * The attribution field a rule compares against.
 *
 * `utm_content` is in this vocabulary but is **not** a field Campaign
 * resolution ranks or compares: it belongs to Ad rules, which are resolved in a
 * second pass over one Campaign's own Ads (ADR-0004). The campaign matcher
 * drops any rule on a field it does not rank, so a `utm_content` rule is
 * structurally incapable of deciding which Campaign an Order belongs to.
 */
export const campaignRuleFieldEnum = pgEnum('campaign_rule_field', [
  'utm_campaign',
  'utm_source',
  'utm_medium',
  'referrer_host',
  'utm_content',
]);

export type CampaignRuleField =
  (typeof campaignRuleFieldEnum.enumValues)[number];

export const campaignRuleOperatorEnum = pgEnum('campaign_rule_operator', [
  'equals',
  'starts_with',
]);

export type CampaignRuleOperator =
  (typeof campaignRuleOperatorEnum.enumValues)[number];

export const CAMPAIGN_RULE_VALUE_LIMIT = 255;

/**
 * How an Order's raw UTM tuple resolves to a Campaign.
 *
 * Per ADR-0001 no Campaign is recorded on an Order — the tuple is the fact and
 * the Campaign is an interpretation, applied by these rules at read time. That
 * is what lets a Campaign created after its ads ran still claim its history, and
 * a corrected rule repair past reports instead of leaving them wrong forever.
 */
export const campaignMatchingRules = pgTable(
  'campaign_matching_rules',
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
    /**
     * Set when the rule belongs to an Ad rather than to the Campaign itself.
     * The Campaign is still named, because an Ad rule is only ever considered
     * among the Ads of the Campaign that already won — the two are never in one
     * contest, and the Campaign matcher loads only the rules where this is null.
     */
    adId: uuid('ad_id').references(() => ads.id, { onDelete: 'cascade' }),
    field: campaignRuleFieldEnum('field').notNull(),
    operator: campaignRuleOperatorEnum('operator').notNull(),
    value: varchar('value', { length: CAMPAIGN_RULE_VALUE_LIMIT }).notNull(),
    /**
     * True for the exact-match rule on the owner's own canonical tag — the
     * Campaign Tag for a Campaign rule, the Ad Tag for an Ad rule — created
     * with the row so a generated link matches without the merchant authoring
     * anything. It is not merchant-authored, so it is not merchant-deletable —
     * removing it would break every link already live.
     */
    isCanonical: boolean('is_canonical').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('campaign_matching_rules_unique').on(
      t.campaignId,
      t.field,
      t.operator,
      t.value,
    ),
    index('campaign_matching_rules_org_store_idx').on(
      t.organizationId,
      t.storeId,
    ),
    index('campaign_matching_rules_campaign_idx').on(t.campaignId),
    index('campaign_matching_rules_ad_idx').on(t.adId),
  ],
);

export type CampaignMatchingRule = typeof campaignMatchingRules.$inferSelect;
export type NewCampaignMatchingRule = typeof campaignMatchingRules.$inferInsert;
