import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, isNull, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type {
  CampaignSpend,
  NewCampaignSpend,
} from '../../../shared/database/schema';
import { campaignSpend } from '../../../shared/database/schema';
import type { SpendDay } from '../utils/spend-day.util';

/**
 * A period's Spend read at every grain the performance report shows it at.
 *
 * The three are not independent: `byCampaign` is the total of an entry in
 * `unsplitByCampaign` and every one of that Campaign's entries in `byAd`. They
 * are returned together, from one read, precisely so that identity holds — a
 * Campaign whose line disagreed with the sum of the lines beneath it would
 * discredit both.
 */
export interface SpendTotals {
  /** Per Campaign id: its own rows plus its Ads'. Minor units. */
  byCampaign: Map<string, number>;
  /** Per Ad id. Minor units. */
  byAd: Map<string, number>;
  /**
   * Per Campaign id: the part recorded without naming an Ad — cost known,
   * split not. Never "spend on no Ad", and never divided among the Ads that
   * exist.
   */
  unsplitByCampaign: Map<string, number>;
}

/** What a merchant supplies for one day's Spend, once validated. */
export interface RecordSpendRow {
  organizationId: string;
  storeId: string;
  campaignId: string;
  /**
   * The Ad the cost was for, or null for a figure recorded against the
   * Campaign as a whole — the cost is known and its split is not.
   */
  adId: string | null;
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
   * Both grains, always: the Campaign's own rows and its Ads'. What a push cost
   * is one figure, and returning only half of it here would let a Campaign and
   * its Ads disagree about it. `adId` on each row is what tells them apart.
   *
   * Pass `adId` to narrow to one creative. Null is not a filter value — it is a
   * grain, and `findForCampaign(campaignId)` already includes it.
   *
   * `between` is inclusive on both ends, which is what a day range means: `to`
   * is the day the period ends in, not an exclusive instant.
   *
   * Within a day the Campaign-level row sorts first. Postgres orders nulls last
   * on an ascending sort, which would put the whole-Campaign figure underneath
   * the creatives it is not a total of — a reading order that invites the wrong
   * sum.
   */
  async findForCampaign(
    campaignId: string,
    orgId: string,
    storeId: string,
    from: SpendDay,
    to: SpendDay,
    adId?: string,
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
          ...(adId ? [eq(campaignSpend.adId, adId)] : []),
        ),
      )
      .orderBy(
        asc(campaignSpend.day),
        sql`${campaignSpend.adId} asc nulls first`,
      );
  }

  /**
   * Total Spend for an inclusive range of calendar days, for the whole Store,
   * at every grain the report reads it at.
   *
   * **One query, three roll-ups.** Spend is recorded either against a Campaign
   * as a whole or against one of its Ads, and the performance report needs all
   * three views of that: what each push cost, what each creative cost, and what
   * part of a push nobody has split yet. Three reads would be three chances for
   * the day range, the tenant filter or the `bigint` cast to drift apart, and
   * the drift would show up as a Campaign disagreeing with the sum of its own
   * lines.
   *
   * Summed in SQL rather than by loading every row: a period of 90 days across
   * a Store's Campaigns is a page of rows nobody looks at. Grains with no Spend
   * in the range are simply absent from the maps — the caller reads that as
   * zero, which is the same answer without inventing rows.
   *
   * `::int` because the column is an integer in minor units and Postgres sums
   * integers as `bigint`, which reaches the driver as a string. The cast keeps
   * the money a number all the way through, as every other summed money column
   * in this codebase does.
   */
  async sumByGrain(
    orgId: string,
    storeId: string,
    from: SpendDay,
    to: SpendDay,
  ): Promise<SpendTotals> {
    const rows = await this.db
      .select({
        campaignId: campaignSpend.campaignId,
        adId: campaignSpend.adId,
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
      .groupBy(campaignSpend.campaignId, campaignSpend.adId);

    const byCampaign = new Map<string, number>();
    const byAd = new Map<string, number>();
    const unsplitByCampaign = new Map<string, number>();

    for (const row of rows) {
      // A Campaign's cost is its own rows plus its Ads'. Rolling both into
      // `byCampaign` here is what keeps the Campaign line the total of the
      // lines beneath it rather than a fourth figure computed elsewhere.
      byCampaign.set(
        row.campaignId,
        (byCampaign.get(row.campaignId) ?? 0) + row.amount,
      );

      if (row.adId === null) {
        unsplitByCampaign.set(
          row.campaignId,
          (unsplitByCampaign.get(row.campaignId) ?? 0) + row.amount,
        );
      } else {
        byAd.set(row.adId, (byAd.get(row.adId) ?? 0) + row.amount);
      }
    }

    return { byCampaign, byAd, unsplitByCampaign };
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

  /**
   * One row, scoped to its Campaign — and, when the caller addressed it beneath
   * an Ad, to that Ad as well.
   *
   * `adId: null` is a real filter here rather than "any": a caller working at
   * the Campaign grain must not reach an Ad's row by id, or the Ad-level
   * routes would be a suggestion rather than a boundary. `undefined` is the
   * "any grain" case, which is what the Campaign-level routes ask for.
   */
  async findById(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
    adId?: string | null,
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
          ...adGrain(adId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Records a day's Spend, correcting the day if it already has a figure.
   *
   * An upsert against `campaign_spend_campaign_ad_day_unique`, not a read
   * followed by an insert or an update. The database is what guarantees one row
   * per day: a read-then-write would let two submits of the same figure both
   * insert, and a doubled day halves a Campaign's ROAS silently and
   * permanently.
   *
   * The conflict target names `ad_id`, and the constraint it infers is declared
   * `NULLS NOT DISTINCT`. Without that declaration a Campaign-level row would
   * conflict with nothing — Postgres would see two different nulls — and this
   * upsert would quietly become an insert for exactly the grain the merchant
   * uses most.
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
        target: [
          campaignSpend.campaignId,
          campaignSpend.adId,
          campaignSpend.day,
        ],
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
        target: [
          campaignSpend.campaignId,
          campaignSpend.adId,
          campaignSpend.day,
        ],
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

  /** Scoped as `findById` is, and for the same reason. */
  async update(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
    data: Partial<Pick<NewCampaignSpend, 'amount' | 'note'>>,
    adId?: string | null,
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
          ...adGrain(adId),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Scoped as `findById` is, and for the same reason. */
  async remove(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
    adId?: string | null,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(campaignSpend)
      .where(
        and(
          eq(campaignSpend.id, id),
          eq(campaignSpend.campaignId, campaignId),
          eq(campaignSpend.organizationId, orgId),
          eq(campaignSpend.storeId, storeId),
          ...adGrain(adId),
        ),
      )
      .returning({ id: campaignSpend.id });
    return deleted.length > 0;
  }
}

/**
 * The `ad_id` clause for a grain, if the caller named one.
 *
 * Three states, and the difference between the last two is the point:
 * `undefined` means any grain, `null` means the Campaign's own rows and not its
 * Ads', and an id means that Ad. Written once because `eq(column, null)` is
 * silently never true in SQL, and a filter that quietly matches nothing on a
 * table holding cost data is the wrong kind of mistake to make twice.
 */
function adGrain(adId: string | null | undefined) {
  if (adId === undefined) return [];
  return [
    adId === null ? isNull(campaignSpend.adId) : eq(campaignSpend.adId, adId),
  ];
}
