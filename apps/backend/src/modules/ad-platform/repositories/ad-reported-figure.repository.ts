import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  between,
  count,
  eq,
  inArray,
  max,
  min,
  sum,
  sql,
} from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { adReportedFigures, ads } from '../../../shared/database/schema';
import type {
  AdPlatform,
  AdReportedFigure,
} from '../../../shared/database/schema';

/** One platform ad's figures for one day, ready to be written. */
export interface ReportedFigureRow {
  organizationId: string;
  storeId: string;
  connectionId: string;
  platform: AdPlatform;
  externalAdId: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** Minor units. Integers throughout — the adapter converted at the edge. */
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  reportedRevenue: number;
  reportedRoasBp: number | null;
  currency: string;
}

/**
 * One platform ad's figures for one day, with the Ad that claims it if one
 * does.
 *
 * The Ad is resolved by the join the figures table was keyed for —
 * `ads.external_id` against `external_ad_id` — rather than by a foreign key,
 * and that is the point: a figure pulled months before anything claimed the ad
 * it describes picks up its Ad the moment a claim is made, backfill included,
 * with no row rewritten and no second pass.
 */
export interface ReportedFigureWithAd {
  figure: AdReportedFigure;
  adId: string | null;
  adName: string | null;
  campaignId: string | null;
}

/**
 * Everything one platform ad has spent since the first day ever pulled for it.
 *
 * Summed rather than stored, because `ad_reported_figures` is already the
 * platform's book and a second copy on the Unlinked Ad would be a second thing
 * to keep correct — and the one a restated day would silently leave wrong.
 */
export interface ReportedSpendToDate {
  externalAdId: string;
  /** The ad account's currency, never converted into the Store's (ADR-0005). */
  currency: string;
  /** Minor units of `currency`. */
  spend: number;
  /** How many days the platform has reported for this ad. */
  days: number;
  firstDay: string;
  lastDay: string;
}

/**
 * How many rows go to the database in one statement.
 *
 * A backfill is a year of days across every ad in an account, which is tens of
 * thousands of rows — one statement for all of them would exceed the driver's
 * parameter limit, and one statement per row would take minutes. This is the
 * middle, and it is the only reason chunking exists here.
 */
const WRITE_CHUNK = 500;

/**
 * The ad platform's own figures, always scoped to one Organization and one
 * Store.
 *
 * Every method takes both and filters on both, in the same shape as every other
 * repository here: a figure belonging to another tenant reads as absent, never
 * as someone else's ad spend.
 *
 * **Nothing in this file writes to `campaign_spend`,** and nothing in
 * `campaign_spend`'s repository writes here. That separation is ADR-0005 made
 * structural rather than remembered: the merchant's book of record and the
 * platform's are two tables with two repositories, and no code path moves a row
 * from one into the other.
 */
@Injectable()
export class AdReportedFigureRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * Writes a pull, correcting what it already holds rather than adding to it.
   *
   * This is where the sync's idempotency actually lives. A sync re-asks for
   * recent days every time it runs, because platforms restate figures after the
   * fact, so the same `(connection, ad, day)` arrives again and again by
   * design. The conflict clause is what makes that a correction; without it a
   * merchant's reported spend would grow every night, agree with nothing, and
   * never throw.
   *
   * `syncedAt` moves on every write, including one that changed no figure. That
   * is deliberate: it records when the row was last *confirmed*, which is what
   * tells a merchant whether a figure is current or merely old.
   */
  async upsertMany(rows: ReportedFigureRow[], syncedAt: Date): Promise<number> {
    if (rows.length === 0) return 0;

    for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
      const chunk = rows.slice(start, start + WRITE_CHUNK);
      await this.db
        .insert(adReportedFigures)
        .values(chunk.map((row) => ({ ...row, syncedAt, updatedAt: syncedAt })))
        .onConflictDoUpdate({
          target: [
            adReportedFigures.connectionId,
            adReportedFigures.externalAdId,
            adReportedFigures.day,
          ],
          set: {
            spend: sql`excluded.spend`,
            impressions: sql`excluded.impressions`,
            clicks: sql`excluded.clicks`,
            conversions: sql`excluded.conversions`,
            reportedRevenue: sql`excluded.reported_revenue`,
            reportedRoasBp: sql`excluded.reported_roas_bp`,
            currency: sql`excluded.currency`,
            syncedAt,
            updatedAt: syncedAt,
          },
        });
    }

    return rows.length;
  }

  /**
   * A Store's Reported Figures for an inclusive range of calendar days, each
   * with the Ad that claims it where one does.
   *
   * Oldest first, and keyed by the platform's ad id rather than by an Ad: most
   * rows here belong to no Ad at all, either because nothing has claimed them
   * yet or because the merchant dismissed the ad and still wants the money
   * visible. The left join is what makes a claim's effect readable — the same
   * rows, suddenly carrying a name.
   *
   * `between` is inclusive on both ends, which is what a day range means — `to`
   * is the day the period ends in, not an exclusive instant.
   */
  async findForStore(
    orgId: string,
    storeId: string,
    from: string,
    to: string,
    platform?: AdPlatform,
  ): Promise<ReportedFigureWithAd[]> {
    const rows = await this.db
      .select({
        figure: adReportedFigures,
        adId: ads.id,
        adName: ads.name,
        campaignId: ads.campaignId,
      })
      .from(adReportedFigures)
      .leftJoin(
        ads,
        and(
          eq(ads.storeId, adReportedFigures.storeId),
          eq(ads.externalId, adReportedFigures.externalAdId),
        ),
      )
      .where(
        and(
          eq(adReportedFigures.organizationId, orgId),
          eq(adReportedFigures.storeId, storeId),
          between(adReportedFigures.day, from, to),
          ...(platform ? [eq(adReportedFigures.platform, platform)] : []),
        ),
      )
      .orderBy(asc(adReportedFigures.day), asc(adReportedFigures.externalAdId));

    return rows;
  }

  /**
   * Every day of spend already pulled for one platform ad, oldest first.
   *
   * What a claim hands to the merchant's book. The figures are keyed on the
   * platform's ad id precisely so this read needs no second pass: the moment an
   * Ad claims that id, the whole pulled history — backfill included — is
   * available to be recorded as that Ad's Spend, and claiming does not start a
   * creative's cost from zero.
   *
   * Only the spend. The revenue, conversions and ROAS beside it in the same row
   * stay here, in the platform's own book (ADR-0005).
   *
   * The currency comes back per day rather than once, because it is
   * denormalized per row and nothing here may sum across two of them.
   */
  async dailySpendFor(
    orgId: string,
    storeId: string,
    externalAdId: string,
  ): Promise<Array<{ day: string; spend: number; currency: string }>> {
    return this.db
      .select({
        day: adReportedFigures.day,
        spend: adReportedFigures.spend,
        currency: adReportedFigures.currency,
      })
      .from(adReportedFigures)
      .where(
        and(
          eq(adReportedFigures.organizationId, orgId),
          eq(adReportedFigures.storeId, storeId),
          eq(adReportedFigures.externalAdId, externalAdId),
        ),
      )
      .orderBy(asc(adReportedFigures.day));
  }

  /**
   * What each of these platform ads has spent in total, over every day ever
   * pulled for it.
   *
   * The figure an Unlinked Ad is judged by: a merchant deciding whether an ad
   * is worth claiming is asking how much it has cost them, not what it cost
   * last Tuesday. Grouped by currency as well as by ad so that no total is ever
   * summed across two of them — ADR-0005 forbids the rate that would take to
   * do honestly.
   */
  async spendToDate(
    orgId: string,
    storeId: string,
    externalAdIds: string[],
  ): Promise<ReportedSpendToDate[]> {
    if (externalAdIds.length === 0) return [];

    const rows = await this.db
      .select({
        externalAdId: adReportedFigures.externalAdId,
        currency: adReportedFigures.currency,
        spend: sum(adReportedFigures.spend),
        days: count(),
        firstDay: min(adReportedFigures.day),
        lastDay: max(adReportedFigures.day),
      })
      .from(adReportedFigures)
      .where(
        and(
          eq(adReportedFigures.organizationId, orgId),
          eq(adReportedFigures.storeId, storeId),
          inArray(adReportedFigures.externalAdId, externalAdIds),
        ),
      )
      .groupBy(adReportedFigures.externalAdId, adReportedFigures.currency);

    return rows.map((row) => ({
      externalAdId: row.externalAdId,
      currency: row.currency,
      // `sum` comes back as a numeric string from the driver; every value that
      // went into it was an integer in minor units, so the total is one too.
      spend: Number(row.spend ?? 0),
      days: Number(row.days ?? 0),
      firstDay: row.firstDay ?? '',
      lastDay: row.lastDay ?? '',
    }));
  }
}
