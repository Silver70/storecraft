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
import {
  adPlatformConnections,
  adPlatformEnum,
} from './ad-platform-connections.schema';

export const AD_REPORTED_FIGURE_LIMITS = {
  externalAdId: 255,
} as const;

/**
 * What an ad platform says one of its ads did on one day.
 *
 * The platform's book, kept beside the merchant's and never merged into it.
 * **Nothing here is ever written into `campaign_spend`** — that table is what
 * the merchant paid and can reconcile against an invoice; this one is what the
 * platform states, on its own attribution window, in its ad account's currency
 * (ADR-0005). The two routinely disagree by a factor of two, and showing both
 * is the entire point.
 *
 * Four decisions in this table are load-bearing:
 *
 * **Keyed by the platform's ad id, not by one of our Ads.** There is
 * deliberately no `ad_id` column. A figure arrives before anything in this
 * Store claims the ad it describes — that claim is a merchant's decision, made
 * later — and keying on `external_ad_id` is what lets a claim pick up the
 * history that was already pulled, including the backfill, rather than needing
 * a second pass to re-attribute rows. An Ad already carries `ads.external_id`;
 * the join is between those two columns and no third table is needed.
 *
 * **`day` is a calendar date, never a timestamp**, for the reason
 * `campaign_spend.day` is: platforms report daily totals, and an instant here
 * would invent a precision the source does not have.
 *
 * **The unique constraint is what makes the sync idempotent.** Pulling the same
 * range twice corrects the same rows instead of doubling them — and a sync
 * re-pulls recent days on purpose, because platforms restate figures for
 * several days after the fact. Without it, a merchant's reported spend would
 * grow every night and never throw.
 *
 * **`currency` is denormalized off the ad account, not read from the Store.**
 * They are allowed to differ and the difference must stay visible: a figure in
 * another currency is stored as what it is, no rate is fetched or inferred, and
 * nothing computes a ratio across the mismatch.
 */
export const adReportedFigures = pgTable(
  'ad_reported_figures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    /**
     * The connection that produced this figure. A disconnect marks that row
     * rather than deleting it precisely so this pointer survives — revoking
     * access never rewrites a past report.
     */
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => adPlatformConnections.id, { onDelete: 'cascade' }),
    /**
     * The source, said on the row itself rather than inferred through the
     * connection. ADR-0005's rule is that a Reported Figure is never mistakable
     * for one of ours, and a label that needs a join to read is one a future
     * report will forget to make.
     */
    platform: adPlatformEnum('platform').notNull(),
    /** The ad's id at the platform, as the platform spells it. */
    externalAdId: varchar('external_ad_id', {
      length: AD_REPORTED_FIGURE_LIMITS.externalAdId,
    }).notNull(),
    /** `YYYY-MM-DD` as the platform reported it. Read as a string, never a Date. */
    day: date('day').notNull(),
    /** In the smallest currency unit of `currency`. Converted in the adapter. */
    spend: integer('spend').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    /** Conversions on the *platform's* attribution window, which is not ours. */
    conversions: integer('conversions').notNull().default(0),
    /**
     * The revenue the platform claims it produced, in minor units. Never an
     * input to Contribution Margin: a platform's conversion value has no cost
     * basis behind it.
     */
    reportedRevenue: integer('reported_revenue').notNull().default(0),
    /**
     * The platform's own ROAS, in basis points — 25000 is 2.5x.
     *
     * An integer for the reason every other ratio here is one: a float in the
     * database is a float in a report. Null means the platform stated none, and
     * that is not zero — nothing recomputes it from the two columns above,
     * because this column is a claim the platform made, not arithmetic of ours.
     */
    reportedRoasBp: integer('reported_roas_bp'),
    /** The ad account's currency at the moment the figure was pulled. */
    currency: varchar('currency', { length: 3 }).notNull(),
    /**
     * The platform's own attribution window, as it stated it: how many days
     * after a click, and after a view, it still credits a conversion.
     *
     * Denormalized onto the row for exactly the reason `currency` and
     * `platform` are. This is the caveat on `conversions`, `reported_revenue`
     * and `reported_roas_bp` in the same row — it is *why* the platform's
     * revenue and ours disagree by a factor of two — and a caveat that needs a
     * join to read is one a future report will render without.
     *
     * Both nullable and independently so. A platform that states no window has
     * not stated a window of zero, and plenty state a click window and no view
     * window. Null renders as "window not stated" rather than as a number
     * nobody claimed: inventing one here would put our guess next to our own
     * Lookback Window as though the platform had agreed to it.
     */
    attributionClickDays: integer('attribution_click_days'),
    attributionViewDays: integer('attribution_view_days'),
    /** When this row was last confirmed by a sync — how stale the figure is. */
    syncedAt: timestamp('synced_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One row per platform ad per day per connection. The database is the
    // authority on that, not the read that preceded the write: a sync running
    // twice over the same range, or two syncs overlapping, must correct rows
    // rather than accumulate them.
    unique('ad_reported_figures_connection_ad_day_unique').on(
      t.connectionId,
      t.externalAdId,
      t.day,
    ),
    index('ad_reported_figures_org_store_day_idx').on(
      t.organizationId,
      t.storeId,
      t.day,
    ),
    // The lookup a claim will make: every day already pulled for one platform
    // ad, so claiming it brings its history along for free.
    index('ad_reported_figures_store_external_ad_idx').on(
      t.storeId,
      t.externalAdId,
    ),
  ],
);

export type AdReportedFigure = typeof adReportedFigures.$inferSelect;
export type NewAdReportedFigure = typeof adReportedFigures.$inferInsert;
