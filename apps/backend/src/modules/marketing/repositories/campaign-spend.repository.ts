import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq } from 'drizzle-orm';
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
