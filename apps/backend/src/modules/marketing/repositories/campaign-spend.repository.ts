import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type {
  CampaignSpend,
  NewCampaignSpend,
} from '../../../shared/database/schema';
import { campaignSpend } from '../../../shared/database/schema';
import type { SpendDay } from '../utils/spend-day.util';

/** What a merchant supplies for one day's Spend, once validated. */
export interface RecordSpendRow {
  organizationId: string;
  storeId: string;
  campaignId: string;
  day: SpendDay;
  amount: number;
  currency: string;
  note: string | null;
}

/**
 * Spend rows, always scoped to one Organization and one Store.
 *
 * Every method takes both and filters on both, in the same shape as
 * `CampaignRepository` — a spend id from another tenant reads as "not found",
 * never as someone else's cost data. The `organization_id` second column and
 * the row-level security session context set per request are the two lines of
 * defence behind that; this is the one the queries actually rely on.
 */
@Injectable()
export class CampaignSpendRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * One Campaign's Spend for an inclusive range of calendar days, oldest first.
   *
   * `between` is inclusive on both ends, which is what a day range means: `to`
   * is the day the period ends in, not an exclusive instant.
   */
  async findForCampaign(
    campaignId: string,
    orgId: string,
    storeId: string,
    from: SpendDay,
    to: SpendDay,
  ): Promise<CampaignSpend[]> {
    return this.db
      .select()
      .from(campaignSpend)
      .where(
        and(
          eq(campaignSpend.campaignId, campaignId),
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
          between(campaignSpend.day, from, to),
        ),
      )
      .orderBy(asc(campaignSpend.day));
  }

  /**
   * Total Spend per Campaign for an inclusive range of calendar days, for the
   * whole Store.
   *
   * Summed in SQL rather than by loading every row: the report needs one figure
   * per Campaign, and a period of 90 days across a Store's Campaigns is a page
   * of rows nobody looks at. Campaigns with no Spend in the range are simply
   * absent from the map — the caller reads that as zero, which is the same
   * answer without inventing rows.
   *
   * `::int` because the column is an integer in minor units and Postgres sums
   * integers as `bigint`, which reaches the driver as a string. The cast keeps
   * the money a number all the way through, as every other summed money column
   * in this codebase does.
   */
  async sumByCampaign(
    orgId: string,
    storeId: string,
    from: SpendDay,
    to: SpendDay,
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        campaignId: campaignSpend.campaignId,
        amount: sql<number>`coalesce(sum(${campaignSpend.amount}), 0)::int`,
      })
      .from(campaignSpend)
      .where(
        and(
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
          between(campaignSpend.day, from, to),
        ),
      )
      .groupBy(campaignSpend.campaignId);

    return new Map(rows.map((row) => [row.campaignId, row.amount]));
  }

  /**
   * Whether this Store has ever recorded Spend at all, for any Campaign on any
   * day.
   *
   * Not a sum and deliberately not one: it exists to tell a Store that has
   * never recorded a cost apart from one that simply spent nothing in the
   * period being read. The dashboard card asks it because those two states
   * deserve different words — an invitation to record some Spend, versus a
   * period that honestly cost nothing — and a period total of zero cannot tell
   * them apart.
   *
   * `limit(1)` because the answer is existence, not a count. A Store with four
   * years of daily rows costs the same as one with none.
   */
  async hasAny(orgId: string, storeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: campaignSpend.id })
      .from(campaignSpend)
      .where(
        and(
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async findById(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
  ): Promise<CampaignSpend | null> {
    const [row] = await this.db
      .select()
      .from(campaignSpend)
      .where(
        and(
          eq(campaignSpend.id, id),
          eq(campaignSpend.campaignId, campaignId),
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Records a day's Spend, correcting the day if it already has a figure.
   *
   * An upsert against `campaign_spend_campaign_day_unique`, not a read followed
   * by an insert or an update. The database is what guarantees one row per day:
   * a read-then-write would let two submits of the same figure both insert, and
   * a doubled day halves a Campaign's ROAS silently and permanently.
   *
   * `setWhere` restates the tenant filter on the update branch. A conflicting
   * row is by construction the same Campaign's, and so the same Organization's,
   * but a write that could only ever land inside the caller's tenant is worth
   * the clause on a table holding cost data.
   */
  async record(row: RecordSpendRow): Promise<CampaignSpend> {
    const values: NewCampaignSpend = row;

    const [saved] = await this.db
      .insert(campaignSpend)
      .values(values)
      .onConflictDoUpdate({
        target: [campaignSpend.campaignId, campaignSpend.day],
        set: {
          amount: row.amount,
          currency: row.currency,
          note: row.note,
          updatedAt: new Date(),
        },
        setWhere: and(
          eq(campaignSpend.organizationId, row.organizationId),
          eq(campaignSpend.storeId, row.storeId),
        ),
      })
      .returning();
    return saved;
  }

  /**
   * Records a whole range of days at once, correcting every day it covers.
   *
   * One `INSERT ... VALUES (...), (...) ON CONFLICT DO UPDATE`, not a loop of
   * single upserts. That makes the range atomic without an explicit
   * transaction: a statement either applies to every day or to none, so a
   * failure halfway cannot leave a merchant with three days of a seven-day
   * total recorded and no indication which four are missing.
   *
   * The `set` clause reads from `excluded` rather than from a captured value,
   * because every row of the statement conflicts with a different existing row
   * and each must take its own new amount. `excluded` is the row Postgres was
   * trying to insert, so each conflicting day updates from its own values.
   *
   * The caller guarantees the days are distinct; Postgres refuses a statement
   * that would update the same row twice, and `enumerateDays` never repeats a
   * day.
   */
  async recordMany(rows: RecordSpendRow[]): Promise<CampaignSpend[]> {
    if (rows.length === 0) return [];

    const values: NewCampaignSpend[] = rows;

    return this.db
      .insert(campaignSpend)
      .values(values)
      .onConflictDoUpdate({
        target: [campaignSpend.campaignId, campaignSpend.day],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          note: sql`excluded.note`,
          updatedAt: new Date(),
        },
        // As in `record`: a conflicting row is by construction the same
        // Campaign's, but a write on cost data that can only land inside the
        // caller's tenant is worth restating.
        setWhere: and(
          eq(campaignSpend.organizationId, rows[0].organizationId),
          eq(campaignSpend.storeId, rows[0].storeId),
        ),
      })
      .returning();
  }

  async update(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
    data: Partial<Pick<NewCampaignSpend, 'amount' | 'note'>>,
  ): Promise<CampaignSpend | null> {
    const [row] = await this.db
      .update(campaignSpend)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(campaignSpend.id, id),
          eq(campaignSpend.campaignId, campaignId),
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async remove(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(campaignSpend)
      .where(
        and(
          eq(campaignSpend.id, id),
          eq(campaignSpend.campaignId, campaignId),
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
        ),
      )
      .returning({ id: campaignSpend.id });
    return deleted.length > 0;
  }
}
