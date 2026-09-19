import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { adReportedFigures } from '../../../shared/database/schema';
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
   * A Store's Reported Figures for an inclusive range of calendar days.
   *
   * Oldest first, and by platform ad rather than by Ad: nothing is linked to an
   * Ad at this stage, and the platform's ad id is the key a later claim will
   * match on.
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
  ): Promise<AdReportedFigure[]> {
    return this.db
      .select()
      .from(adReportedFigures)
      .where(
        and(
          eq(adReportedFigures.organizationId, orgId),
          eq(adReportedFigures.storeId, storeId),
          between(adReportedFigures.day, from, to),
          ...(platform ? [eq(adReportedFigures.platform, platform)] : []),
        ),
      )
      .orderBy(asc(adReportedFigures.day), asc(adReportedFigures.externalAdId));
  }
}
