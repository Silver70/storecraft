import {
  pgTable,
  uuid,
  integer,
  date,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { ads } from './ads.schema';

/**
 * What the ad platform reported for one Ad on one day — the only figures of the
 * platform's that are kept.
 *
 * Three measurements: what the ad account was charged, how many times the Ad
 * was shown, and how many people followed its link to the Store. The platform's
 * own revenue, conversions and ROAS are not stored here or anywhere (ADR-0006);
 * revenue is ours, computed from Orders.
 *
 * Unique on `(ad_id, day)` so a sync can upsert the same window twice and get
 * the same rows back, which it has to: the platform restates recent days. A
 * Campaign's figures are the sum of its Ads', so there is no campaign-level
 * row to disagree with them.
 *
 * `day` is the platform's date for the figure, which is the ad account's day.
 * The ad account is always in the Store's currency (a mismatch is never
 * connected), so `spend` needs no currency of its own.
 */
export const adDailyFigures = pgTable(
  'ad_daily_figures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    adId: uuid('ad_id')
      .notNull()
      .references(() => ads.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    /** In minor units of the Store's currency. Never a float. */
    spend: integer('spend').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    /** Link clicks only — people who reached the Store. */
    clicks: integer('clicks').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('ad_daily_figures_ad_day_unique').on(t.adId, t.day),
    index('ad_daily_figures_org_store_day_idx').on(
      t.organizationId,
      t.storeId,
      t.day,
    ),
  ],
);

export type AdDailyFigure = typeof adDailyFigures.$inferSelect;
export type NewAdDailyFigure = typeof adDailyFigures.$inferInsert;
