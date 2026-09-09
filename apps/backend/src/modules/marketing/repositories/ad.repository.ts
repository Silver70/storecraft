import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type {
  Ad,
  AdStatus,
  CampaignMatchingRule,
  NewAd,
  NewCampaignMatchingRule,
} from '../../../shared/database/schema';
import { ads, campaignMatchingRules } from '../../../shared/database/schema';
import type { MatchableAdRule } from '../utils/ad-matching.util';

/**
 * Every method takes the organization and store explicitly and filters on both,
 * and every method that names an Ad also names the Campaign it hangs from. An
 * Ad has no meaning outside its Campaign, so an ad id from another tenant — or
 * from a sibling Campaign — reads as "not found", never as someone else's row.
 */
@Injectable()
export class AdRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findManyForCampaign(
    campaignId: string,
    orgId: string,
    storeId: string,
    status?: AdStatus,
  ): Promise<Ad[]> {
    return this.db
      .select()
      .from(ads)
      .where(
        and(
          eq(ads.campaignId, campaignId),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
          ...(status ? [eq(ads.status, status)] : []),
        ),
      )
      .orderBy(asc(ads.createdAt));
  }

  /**
   * Every Ad in the Store, across every Campaign — what the performance report
   * needs to name the lines of its split.
   *
   * Archived included, and deliberately: an archived creative that earned money
   * in the period, or that money was spent against, must still appear on the
   * report with its name on it. Which of them is shown is the report's
   * decision, made on the same three grounds it already applies to Campaigns.
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

  /** Whether this Campaign already owns the tag. Sibling Campaigns are free to. */
  async tagExists(
    tag: string,
    campaignId: string,
    orgId: string,
    storeId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: ads.id })
      .from(ads)
      .where(
        and(
          eq(ads.campaignId, campaignId),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
          eq(ads.tag, tag),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async create(
    data: Omit<NewAd, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Ad> {
    const [row] = await this.db.insert(ads).values(data).returning();
    return row;
  }

  async update(
    id: string,
    campaignId: string,
    orgId: string,
    storeId: string,
    data: Partial<
      Omit<
        NewAd,
        'id' | 'organizationId' | 'storeId' | 'campaignId' | 'createdAt'
      >
    >,
  ): Promise<Ad | null> {
    const [row] = await this.db
      .update(ads)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(ads.id, id),
          eq(ads.campaignId, campaignId),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Archives every Ad of a Campaign that is not already archived, and answers
   * with the rows it changed.
   *
   * Already-archived Ads are skipped rather than re-stamped so that archiving a
   * Campaign does not rewrite the date a creative was actually retired on. The
   * cascade is one statement, so a Campaign with forty Ads is one write.
   */
  async archiveForCampaign(
    campaignId: string,
    orgId: string,
    storeId: string,
    archivedAt: Date,
  ): Promise<Ad[]> {
    return this.db
      .update(ads)
      .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
      .where(
        and(
          eq(ads.campaignId, campaignId),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
          ne(ads.status, 'archived'),
        ),
      )
      .returning();
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

  /**
   * Every Ad rule in the Store, as the second-pass matcher reads them.
   *
   * The mirror image of `CampaignRepository.findMatchableRules`, which loads
   * only the rules where `ad_id` is null: between them the two reads partition
   * the rule table, and neither matcher can ever be handed the other's rules.
   * That is ADR-0004's guarantee said in SQL, one layer below where
   * `createAdMatcher` says it again in TypeScript.
   *
   * `campaignId` comes back on every row because it is the key the matcher
   * groups candidates under — an Ad is only ever considered among the Ads of
   * the Campaign that already won.
   */
  async findMatchableAdRules(
    orgId: string,
    storeId: string,
  ): Promise<MatchableAdRule[]> {
    const rows = await this.db
      .select({
        adId: campaignMatchingRules.adId,
        campaignId: campaignMatchingRules.campaignId,
        field: campaignMatchingRules.field,
        operator: campaignMatchingRules.operator,
        value: campaignMatchingRules.value,
        adCreatedAt: ads.createdAt,
      })
      .from(campaignMatchingRules)
      .innerJoin(ads, eq(ads.id, campaignMatchingRules.adId))
      .where(
        and(
          eq(campaignMatchingRules.organizationId, orgId),
          eq(campaignMatchingRules.storeId, storeId),
          isNotNull(campaignMatchingRules.adId),
        ),
      );

    // The inner join already guarantees a non-null `ad_id`; the cast is what
    // tells the type system so, since the column is nullable on the table.
    return rows.map((row) => ({ ...row, adId: row.adId as string }));
  }

  /** An Ad's own rules — the ones carrying its id, never its Campaign's. */
  async findRulesForAd(
    adId: string,
    orgId: string,
    storeId: string,
  ): Promise<CampaignMatchingRule[]> {
    return this.db
      .select()
      .from(campaignMatchingRules)
      .where(
        and(
          eq(campaignMatchingRules.adId, adId),
          eq(campaignMatchingRules.organizationId, orgId),
          eq(campaignMatchingRules.storeId, storeId),
        ),
      )
      .orderBy(asc(campaignMatchingRules.createdAt));
  }
}
