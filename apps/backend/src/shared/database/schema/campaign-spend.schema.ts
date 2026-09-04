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

export const CAMPAIGN_SPEND_NOTE_LIMIT = 255;

/**
 * What a merchant paid for a Campaign on one day.
 *
 * Three decisions in this table are load-bearing:
 *
 * `day` is a calendar date and never a timestamp. Ad platforms report daily
 * totals, so storing an instant would invent a precision the source data does
 * not have. It is interpreted in the Store's timezone, because the day a
 * merchant is closing out is the day their ad platform is reporting.
 *
 * The unique constraint on `(campaign_id, day)` makes recording Spend an
 * upsert rather than an insert. That is what makes a double-submit correct a
 * day instead of doubling it — a failure that would halve a Campaign's ROAS
 * silently and forever, and never throw.
 *
 * `currency` is denormalized onto the row rather than read from the Store when
 * a report is computed. A Store that changes its currency later must not
 * silently reinterpret Spend already recorded as a different unit of money.
 * There is no conversion anywhere in this feature.
 *
 * Unlike a Campaign, a Spend row is editable and deletable. A Campaign is
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
    unique('campaign_spend_campaign_day_unique').on(t.campaignId, t.day),
    index('campaign_spend_org_store_day_idx').on(
      t.organizationId,
      t.storeId,
      t.day,
    ),
    index('campaign_spend_campaign_day_idx').on(t.campaignId, t.day),
  ],
);

export type CampaignSpend = typeof campaignSpend.$inferSelect;
export type NewCampaignSpend = typeof campaignSpend.$inferInsert;
