import {
  pgTable,
  uuid,
  varchar,
  integer,
  date,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { campaigns } from './campaigns.schema';
import { ads } from './ads.schema';

export const CAMPAIGN_SPEND_NOTE_LIMIT = 255;

/**
 * What a merchant paid for a Campaign — or for one Ad under it — on one day.
 *
 * Four decisions in this table are load-bearing:
 *
 * `day` is a calendar date and never a timestamp. Ad platforms report daily
 * totals, so storing an instant would invent a precision the source data does
 * not have. It is interpreted in the Store's timezone, because the day a
 * merchant is closing out is the day their ad platform is reporting.
 *
 * `ad_id` is nullable, and a null means the cost is known and its split is not
 * — never that the cost belongs to no Ad. A Campaign's Spend for a period is
 * therefore the sum of its own rows *and* its Ads' rows; the two levels are
 * one figure read at two grains, and they must never disagree.
 *
 * The unique constraint makes recording Spend an upsert rather than an insert.
 * That is what makes a double-submit correct a day instead of doubling it — a
 * failure that would halve a Campaign's ROAS silently and forever, and never
 * throw. It is declared `NULLS NOT DISTINCT` for exactly that reason: under
 * Postgres' default, two null `ad_id`s count as different values, so a plain
 * unique on `(campaign_id, ad_id, day)` would happily admit two Campaign-level
 * rows for one day and reintroduce the doubling this constraint exists to
 * prevent. See `0014_spend_against_an_ad`.
 *
 * `currency` is denormalized onto the row rather than read from the Store when
 * a report is computed. A Store that changes its currency later must not
 * silently reinterpret Spend already recorded as a different unit of money.
 * There is no conversion anywhere in this feature.
 *
 * Unlike a Campaign or an Ad, a Spend row is editable and deletable. Those are
 * history that explains Orders; a Spend row is a record of what a merchant
 * typed, and a wrong one should be removable rather than preserved.
 */
export const campaignSpend = pgTable(
  'campaign_spend',
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
     * The creative this cost was for, when the merchant knows which one.
     *
     * Null is a statement about knowledge, not about structure: the Campaign
     * cost this much and the split across its Ads is unknown. Nothing here
     * invents an Ad to hang a null on — a synthetic "default Ad" would sit in
     * the card grid forever claiming to be a creative that never ran.
     */
    adId: uuid('ad_id').references(() => ads.id, { onDelete: 'cascade' }),
    /** `YYYY-MM-DD` in the Store's timezone. Read as a string, never a Date. */
    day: date('day').notNull(),
    /** In the smallest currency unit, like every other money column here. */
    amount: integer('amount').notNull(),
    /** The Store's currency at the moment the row was recorded. */
    currency: varchar('currency', { length: 3 }).notNull(),
    note: varchar('note', { length: CAMPAIGN_SPEND_NOTE_LIMIT }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The database is the authority on one-row-per-day, not the read that
    // preceded the write — two submits of the same figure must not both win.
    //
    // `NULLS NOT DISTINCT` is the whole of this line's correctness. Postgres
    // treats nulls as distinct by default, so without it two Campaign-level
    // rows (`ad_id IS NULL`) for the same day would both be admitted, the
    // upsert would find nothing to conflict with, and a double-submit would
    // silently double that day's cost. What it buys: at most one
    // Campaign-level row per day, and at most one row per Ad per day.
    unique('campaign_spend_campaign_ad_day_unique')
      .on(t.campaignId, t.adId, t.day)
      .nullsNotDistinct(),
    index('campaign_spend_org_store_day_idx').on(
      t.organizationId,
      t.storeId,
      t.day,
    ),
    index('campaign_spend_campaign_day_idx').on(t.campaignId, t.day),
    index('campaign_spend_ad_day_idx').on(t.adId, t.day),
  ],
);

export type CampaignSpend = typeof campaignSpend.$inferSelect;
export type NewCampaignSpend = typeof campaignSpend.$inferInsert;
