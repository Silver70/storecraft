import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { Campaign } from '../../../shared/database/schema';
import { campaigns } from '../../../shared/database/schema';

/**
 * Every method takes the organization and store explicitly and filters on both.
 * A Campaign is only ever visible inside the Store that owns it — a campaign id
 * from another tenant reads as "not found", never as someone else's row.
 *
 * Reads only. A Campaign arrives from the ad platform — created there through
 * the provider, or discovered by the sync — and neither path exists yet.
 */
@Injectable()
export class CampaignRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findMany(orgId: string, storeId: string): Promise<Campaign[]> {
    return this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
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
}
