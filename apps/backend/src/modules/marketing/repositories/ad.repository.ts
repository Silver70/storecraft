import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { Ad } from '../../../shared/database/schema';
import { ads } from '../../../shared/database/schema';

/**
 * Every method takes the organization and store explicitly and filters on both,
 * and every method that names an Ad also names the Campaign it hangs from. An
 * ad id from another tenant — or from a sibling Campaign — reads as "not
 * found", never as someone else's row.
 *
 * Reads only, for the reason `CampaignRepository` is.
 */
@Injectable()
export class AdRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findManyForCampaign(
    campaignId: string,
    orgId: string,
    storeId: string,
  ): Promise<Ad[]> {
    return this.db
      .select()
      .from(ads)
      .where(
        and(
          eq(ads.campaignId, campaignId),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
        ),
      )
      .orderBy(asc(ads.createdAt));
  }

  /**
   * Every Ad in the Store, across every Campaign — what the report needs to
   * resolve a Touch's `utm_content` and to name the lines of its split.
   */
  async findManyForStore(orgId: string, storeId: string): Promise<Ad[]> {
    return this.db
      .select()
      .from(ads)
      .where(and(eq(ads.organizationId, orgId), eq(ads.storeId, storeId)))
      .orderBy(asc(ads.createdAt));
  }

  async findById(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
  ): Promise<Ad | null> {
    const [row] = await this.db
      .select()
      .from(ads)
      .where(
        and(
          eq(ads.id, id),
          eq(ads.campaignId, campaignId),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
