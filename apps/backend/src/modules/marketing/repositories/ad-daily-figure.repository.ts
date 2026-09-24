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
}
