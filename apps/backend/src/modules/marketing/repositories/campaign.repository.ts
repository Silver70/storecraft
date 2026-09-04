import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type {
  Campaign,
  CampaignMatchingRule,
  CampaignStatus,
  NewCampaign,
  NewCampaignMatchingRule,
} from '../../../shared/database/schema';
import {
  campaignMatchingRules,
  campaigns,
} from '../../../shared/database/schema';

/**
 * Every method takes the organization and store explicitly and filters on both.
 * A Campaign is only ever visible inside the Store that owns it — a campaign id
 * from another tenant reads as "not found", never as someone else's row.
 */
@Injectable()
export class CampaignRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  async findMany(
    orgId: string,
    storeId: string,
    status?: CampaignStatus,
  ): Promise<Campaign[]> {
    return this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
          ...(status ? [eq(campaigns.status, status)] : []),
        ),
      )
      .orderBy(asc(campaigns.createdAt));
  }

  async findById(
    id: string,
    orgId: string,
    storeId: string,
  ): Promise<Campaign | null> {
    const [row] = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async tagExists(
    tag: string,
    orgId: string,
    storeId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
          eq(campaigns.tag, tag),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async create(
    data: Omit<NewCampaign, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Campaign> {
    const [row] = await this.db.insert(campaigns).values(data).returning();
    return row;
  }

  async update(
    id: string,
    orgId: string,
    storeId: string,
    data: Partial<
      Omit<NewCampaign, 'id' | 'organizationId' | 'storeId' | 'createdAt'>
    >,
  ): Promise<Campaign | null> {
    const [row] = await this.db
      .update(campaigns)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  // ─── Matching rules ─────────────────────────────────────────────────────────

  async createRule(
    data: Omit<NewCampaignMatchingRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CampaignMatchingRule> {
    const [row] = await this.db
      .insert(campaignMatchingRules)
      .values(data)
      .returning();
    return row;
  }

  async findRulesForCampaign(
    campaignId: string,
    orgId: string,
    storeId: string,
  ): Promise<CampaignMatchingRule[]> {
    return this.db
      .select()
      .from(campaignMatchingRules)
      .where(
        and(
          eq(campaignMatchingRules.campaignId, campaignId),
          eq(campaignMatchingRules.organizationId, orgId),
          eq(campaignMatchingRules.storeId, storeId),
        ),
      )
      .orderBy(asc(campaignMatchingRules.createdAt));
  }
}
