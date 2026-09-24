import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import { adDailyFigures } from '../../../shared/database/schema';

/** What the platform reported for one Ad over a range of days, summed. */
export interface AdFigures {
  /** In minor units. */
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Reads the platform's per-Ad daily figures. Scoped to one Organization and
 * Store on every read, like everything else tenant-owned.
 *
 * Read-only here. The sync is the table's only writer
 * (`ad-platform/repositories/campaign-mirror.repository.ts`), so a figure on
 * the page is always one the platform reported and never one typed in.
 */
@Injectable()
export class AdDailyFigureRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * Each Ad's figures summed over an inclusive range of `YYYY-MM-DD` days. An
   * Ad with no rows in the range is absent from the map.
   */
  async sumByAd(
    orgId: string,
    storeId: string,
    fromDay: string,
    toDay: string,
  ): Promise<Map<string, AdFigures>> {
    const rows = await this.db
      .select({
        adId: adDailyFigures.adId,
        // `sum` of an integer column is a bigint, which the driver returns as
        // a string; cast back so no caller ever sees one.
        spend: sql<number>`coalesce(sum(${adDailyFigures.spend}), 0)::int`,
        impressions: sql<number>`coalesce(sum(${adDailyFigures.impressions}), 0)::int`,
        clicks: sql<number>`coalesce(sum(${adDailyFigures.clicks}), 0)::int`,
      })
      .from(adDailyFigures)
      .where(
        and(
          eq(adDailyFigures.organizationId, orgId),
          eq(adDailyFigures.storeId, storeId),
          gte(adDailyFigures.day, fromDay),
          lte(adDailyFigures.day, toDay),
        ),
      )
      .groupBy(adDailyFigures.adId);

    return new Map(
      rows.map((row) => [
        row.adId,
        {
          spend: Number(row.spend),
          impressions: Number(row.impressions),
          clicks: Number(row.clicks),
        },
      ]),
    );
  }

  /**
   * Each Ad's whole history in one line: everything the platform ever charged
   * for it, and the last day it reported anything. An Ad with no rows at all is
   * absent from the map.
   *
   * What a Campaign is recognised by and when it stopped are questions about
   * its whole life, not about whichever period a report happens to cover.
   */
  async lifetimeByAd(
    orgId: string,
    storeId: string,
  ): Promise<Map<string, AdLifetime>> {
    const rows = await this.db
      .select({
        adId: adDailyFigures.adId,
        spend: sql<number>`coalesce(sum(${adDailyFigures.spend}), 0)::bigint`,
        lastDay: sql<string>`max(${adDailyFigures.day})::text`,
      })
      .from(adDailyFigures)
      .where(
        and(
          eq(adDailyFigures.organizationId, orgId),
          eq(adDailyFigures.storeId, storeId),
        ),
      )
      .groupBy(adDailyFigures.adId);

    return new Map(
      rows.map((row) => [
        row.adId,
        { spend: Number(row.spend), lastDay: row.lastDay },
      ]),
    );
  }
}

/** One Ad's whole history, reduced to what a Campaign's card needs from it. */
export interface AdLifetime {
  /** Everything the platform ever charged for the Ad, in minor units. */
  spend: number;
  /** The last `YYYY-MM-DD` the platform reported a figure for it. */
  lastDay: string;
}
