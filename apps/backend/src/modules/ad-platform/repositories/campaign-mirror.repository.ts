import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  between,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import {
  AD_LIMITS,
  CAMPAIGN_LIMITS,
  adDailyFigures,
  ads,
  campaigns,
} from '../../../shared/database/schema';
import type {
  AdFormat,
  AdReviewStatus,
  AdPlatform,
  Campaign,
  CampaignBudgetLevel,
  CampaignStatus,
} from '../../../shared/database/schema';

/**
 * Whose rows these are. Every write here carries all three, taken from the
 * connection being synced — the sync runs with no request and therefore no
 * Organization of its own, so the tenancy guarantee is kept by the rows.
 */
export interface MirrorScope {
  organizationId: string;
  storeId: string;
  platform: AdPlatform;
}

export interface MirroredCampaignInput {
  externalId: string;
  name: string | null;
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Null where the platform did not say, which leaves the stored budget alone. */
  budgetLevel: CampaignBudgetLevel | null;
  /** In minor units. Only meaningful beside a `budgetLevel`. */
  dailyBudget: number | null;
}

export interface MirroredAdInput {
  campaignId: string;
  externalId: string;
  name: string | null;
  format: AdFormat | null;
  status: CampaignStatus;
  reviewStatus: AdReviewStatus | null;
  adSetExternalId: string | null;
}

/** A row as the sync needs it back: its id, and what is still owed on it. */
export interface MirroredCampaign {
  id: string;
  externalId: string;
  /** Whether this upsert created the row — a campaign discovered just now. */
  inserted: boolean;
}

export interface MirroredAd {
  id: string;
  externalId: string;
  inserted: boolean;
  /** Null until the creative has been copied into our own storage. */
  creativeUrl: string | null;
  /** Null until the Ad's link tags have been read. */
  linkTagsCheckedAt: Date | null;
}

/** A Campaign and its Ads, as Start tracking needs them. */
export interface CampaignToTrack {
  id: string;
  externalId: string;
  name: string;
  platform: AdPlatform;
  hasLinkTags: boolean;
  ads: {
    id: string;
    externalId: string;
    name: string;
    hasLinkTags: boolean;
  }[];
}

/** A Campaign and its Ads, as an edit needs them. */
export interface CampaignToEdit {
  campaign: Campaign;
  ads: {
    id: string;
    externalId: string;
    name: string;
    status: CampaignStatus;
    creativeUrl: string | null;
    adSetExternalId: string | null;
  }[];
}

/**
 * What an edit the platform accepted changed about a Campaign. Absent fields
 * are left as they are; `endsAt: null` clears the end.
 */
export interface CampaignChange {
  name?: string;
  dailyBudget?: number;
  endsAt?: Date | null;
  status?: CampaignStatus;
  coverUrl?: string;
}

/** A Campaign created here, as the platform answered for it. */
export interface CreatedCampaignInput {
  /** The create's idempotency key, which finds this row again on a retry. */
  creationKey: string;
  externalId: string;
  name: string;
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Per day, in minor units. Every campaign created here budgets on the campaign. */
  dailyBudget: number;
  /** The first ad's image, in storage we control. */
  coverUrl: string | null;
  ads: CreatedAdInput[];
}

export interface CreatedAdInput {
  externalId: string;
  name: string;
  format: AdFormat | null;
  status: CampaignStatus;
  reviewStatus: AdReviewStatus | null;
  /** The image the ad was made from, already in storage we control. */
  creativeUrl: string | null;
  adSetExternalId: string | null;
}

export interface DailyFigureInput {
  adId: string;
  day: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Rows per statement. Postgres takes at most 65,535 parameters, and a figure
 * row is eight — a ninety-day backfill of a hundred ads is nine thousand rows,
 * which one statement would not survive.
 */
const CHUNK = 1000;

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(rows.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * The only writer of Campaigns, Ads and `ad_daily_figures`: what the sync
 * reads from the platform, and a Campaign created here, written from the
 * platform's answer to the create.
 *
 * ## Idempotent by construction, statement by statement
 *
 * Every write is an upsert keyed on the platform's own ids — `(store_id,
 * external_id)` for Campaigns and Ads, `(ad_id, day)` for figures — so running
 * the same sync twice produces the same rows, not doubled ones. That matters
 * twice over here. The platform restates recent days, so every sync re-reads
 * days it already holds. And the production driver cannot hold a transaction
 * open across statements, so a sync that dies between two writes must leave
 * rows the next sync can simply write again, rather than a half-applied change
 * something would have to undo.
 *
 * ## What it never touches
 *
 * `cover_url` once set, and `has_link_tags` except through the two methods that
 * own it. A rename or a status change on the platform updates the columns the
 * platform owns and nothing a merchant or another path decided.
 */
@Injectable()
export class CampaignMirrorRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  /**
   * Inserts the campaigns this Store has no row for and refreshes the ones it
   * has. A discovered campaign is simply inserted — there is no claim queue,
   * no pending state and nothing held back.
   */
  async upsertCampaigns(
    scope: MirrorScope,
    rows: readonly MirroredCampaignInput[],
    at: Date,
  ): Promise<MirroredCampaign[]> {
    const out: MirroredCampaign[] = [];
    for (const chunk of chunks(rows)) {
      const written = await this.db
        .insert(campaigns)
        .values(
          chunk.map((row) => ({
            organizationId: scope.organizationId,
            storeId: scope.storeId,
            platform: scope.platform,
            externalId: row.externalId,
            name: nameOr(
              row.name,
              `Campaign ${row.externalId}`,
              CAMPAIGN_LIMITS.name,
            ),
            status: row.status,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            budgetLevel: row.budgetLevel,
            dailyBudget: row.budgetLevel ? row.dailyBudget : null,
            createdAt: at,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [campaigns.storeId, campaigns.externalId],
          set: {
            name: sql`excluded.name`,
            status: sql`excluded.status`,
            startsAt: sql`excluded.starts_at`,
            endsAt: sql`excluded.ends_at`,
            // The platform owns the budget, so its answer replaces ours. A
            // read that did not say where the budget lives says nothing
            // about it, and leaves what is stored.
            budgetLevel: sql`coalesce(excluded.budget_level, ${campaigns.budgetLevel})`,
            dailyBudget: sql`CASE WHEN excluded.budget_level IS NULL THEN ${campaigns.dailyBudget} ELSE excluded.daily_budget END`,
            updatedAt: sql`excluded.updated_at`,
          },
          // A row in this Store that is somehow another Organization's is not
          // overwritten. It cannot be — `store_id` belongs to one — but the
          // guarantee should not rest on that.
          setWhere: eq(campaigns.organizationId, scope.organizationId),
        })
        .returning({
          id: campaigns.id,
          externalId: campaigns.externalId,
          // `xmax` is zero on a row this statement inserted and non-zero on
          // one it updated — Postgres's own answer to "was this new".
          inserted: sql<boolean>`(xmax = 0)`,
        });
      out.push(...written);
    }
    return out;
  }

  /**
   * Inserts and refreshes Ads, each under the Campaign the platform files it
   * under now.
   */
  async upsertAds(
    scope: MirrorScope,
    rows: readonly MirroredAdInput[],
    at: Date,
  ): Promise<MirroredAd[]> {
    const out: MirroredAd[] = [];
    for (const chunk of chunks(rows)) {
      const written = await this.db
        .insert(ads)
        .values(
          chunk.map((row) => ({
            organizationId: scope.organizationId,
            storeId: scope.storeId,
            campaignId: row.campaignId,
            externalId: row.externalId,
            name: nameOr(row.name, `Ad ${row.externalId}`, AD_LIMITS.name),
            format: row.format,
            status: row.status,
            reviewStatus: row.reviewStatus,
            adSetExternalId: row.adSetExternalId,
            createdAt: at,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [ads.storeId, ads.externalId],
          set: {
            campaignId: sql`excluded.campaign_id`,
            name: sql`excluded.name`,
            // A format the platform has stopped reporting is kept rather than
            // erased: the creative did not stop being a video.
            format: sql`coalesce(excluded.format, ${ads.format})`,
            adSetExternalId: sql`coalesce(excluded.ad_set_external_id, ${ads.adSetExternalId})`,
            status: sql`excluded.status`,
            // Written as reported, null included: a verdict the platform has
            // withdrawn is not one to keep showing.
            reviewStatus: sql`excluded.review_status`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(ads.organizationId, scope.organizationId),
        })
        .returning({
          id: ads.id,
          externalId: ads.externalId,
          inserted: sql<boolean>`(xmax = 0)`,
          creativeUrl: ads.creativeUrl,
          linkTagsCheckedAt: ads.linkTagsCheckedAt,
        });
      out.push(...written);
    }
    return out;
  }

  /**
   * Makes the stored figures for these Ads over `[from, to]` exactly what the
   * platform just reported.
   *
   * Upserted on `(ad_id, day)`, so a restated day overwrites the old one. Then
   * any day inside the window that the platform no longer reports is removed —
   * a day it restated down to nothing must not keep yesterday's spend.
   *
   * The removal is by write stamp rather than by deleting first: a failure
   * between the two statements then leaves the old figures standing rather
   * than a hole, which is the promise a failed sync makes — the page keeps
   * serving what it already had.
   */
  async replaceFigures(
    scope: MirrorScope,
    adIds: readonly string[],
    from: string,
    to: string,
    rows: readonly DailyFigureInput[],
  ): Promise<void> {
    if (!adIds.length) return;
    const writtenAt = new Date();

    for (const chunk of chunks(rows)) {
      await this.db
        .insert(adDailyFigures)
        .values(
          chunk.map((row) => ({
            organizationId: scope.organizationId,
            storeId: scope.storeId,
            adId: row.adId,
            day: row.day,
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            createdAt: writtenAt,
            updatedAt: writtenAt,
          })),
        )
        .onConflictDoUpdate({
          target: [adDailyFigures.adId, adDailyFigures.day],
          set: {
            spend: sql`excluded.spend`,
            impressions: sql`excluded.impressions`,
            clicks: sql`excluded.clicks`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(adDailyFigures.organizationId, scope.organizationId),
        });
    }

    for (const ids of chunks(adIds)) {
      await this.db
        .delete(adDailyFigures)
        .where(
          and(
            eq(adDailyFigures.organizationId, scope.organizationId),
            eq(adDailyFigures.storeId, scope.storeId),
            inArray(adDailyFigures.adId, ids),
            between(adDailyFigures.day, from, to),
            lt(adDailyFigures.updatedAt, writtenAt),
          ),
        );
    }
  }

  /**
   * Marks Ended every Campaign and Ad on this platform that the platform no
   * longer reports.
   *
   * Called only after a complete read of the ad account: the tree returns every
   * campaign whatever the date range, deleted ones included, so an absence from
   * a complete read means the platform has let go of it. It is ended rather
   * than removed — it spent money, and its history stays readable. A later
   * sync that sees it again simply writes its real status back.
   */
  async markUnreportedEnded(
    scope: MirrorScope,
    reportedCampaignIds: readonly string[],
    reportedAdIds: readonly string[],
    at: Date,
  ): Promise<void> {
    const platformCampaigns = this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.organizationId, scope.organizationId),
          eq(campaigns.storeId, scope.storeId),
          eq(campaigns.platform, scope.platform),
        ),
      );

    await this.db
      .update(campaigns)
      .set({ status: 'ended', updatedAt: at })
      .where(
        and(
          eq(campaigns.organizationId, scope.organizationId),
          eq(campaigns.storeId, scope.storeId),
          eq(campaigns.platform, scope.platform),
          ne(campaigns.status, 'ended'),
          notInArray(campaigns.externalId, [...reportedCampaignIds]),
        ),
      );

    await this.db
      .update(ads)
      .set({ status: 'ended', updatedAt: at })
      .where(
        and(
          eq(ads.organizationId, scope.organizationId),
          eq(ads.storeId, scope.storeId),
          inArray(ads.campaignId, platformCampaigns),
          ne(ads.status, 'ended'),
          notInArray(ads.externalId, [...reportedAdIds]),
        ),
      );
  }

  /**
   * Writes a Campaign created here, and its Ads, from what the platform
   * answered — so it is on the grid now rather than after the next sync.
   *
   * Upserted on the platform's ids like everything else here. A retried create
   * that the platform answered with the same campaign writes the same rows, and
   * a sync that discovered the campaign first is simply joined. Its Cover and
   * its Ads' creatives are filled only where missing, as the sync fills them.
   *
   * Every Ad is written as carrying our Link Tags. They went out in the call
   * that made it. `link_tags_checked_at` stays null, so the tags are confirmed
   * by reading them back, here or by the next sync, rather than taken on trust.
   */
  async recordCreated(
    scope: MirrorScope,
    input: CreatedCampaignInput,
    at: Date,
  ): Promise<{ campaignId: string; adIds: Map<string, string> }> {
    const [campaign] = await this.db
      .insert(campaigns)
      .values({
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        platform: scope.platform,
        externalId: input.externalId,
        name: nameOr(
          input.name,
          `Campaign ${input.externalId}`,
          CAMPAIGN_LIMITS.name,
        ),
        status: input.status,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        coverUrl: input.coverUrl,
        creationKey: input.creationKey,
        budgetLevel: 'campaign',
        dailyBudget: input.dailyBudget,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [campaigns.storeId, campaigns.externalId],
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          budgetLevel: sql`excluded.budget_level`,
          dailyBudget: sql`excluded.daily_budget`,
          coverUrl: sql`coalesce(${campaigns.coverUrl}, excluded.cover_url)`,
          creationKey: sql`coalesce(${campaigns.creationKey}, excluded.creation_key)`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: eq(campaigns.organizationId, scope.organizationId),
      })
      .returning({ id: campaigns.id });

    const adIds = await this.insertCreatedAds(
      scope,
      campaign.id,
      input.ads,
      at,
    );
    return { campaignId: campaign.id, adIds };
  }

  /**
   * Writes an Ad added here to a running Campaign, from what the platform
   * answered, as a create writes its Ads. Answers with the Ad's id here.
   */
  async recordAdded(
    scope: MirrorScope,
    campaignId: string,
    ad: CreatedAdInput,
    creationKey: string,
    at: Date,
  ): Promise<string> {
    const adIds = await this.insertCreatedAds(
      scope,
      campaignId,
      [ad],
      at,
      creationKey,
    );
    return adIds.get(ad.externalId)!;
  }

  /** The Ad an add with this key already made here, or null. */
  async findAdByCreationKey(
    orgId: string,
    storeId: string,
    creationKey: string,
  ): Promise<{ id: string; externalId: string; campaignId: string } | null> {
    const [row] = await this.db
      .select({
        id: ads.id,
        externalId: ads.externalId,
        campaignId: ads.campaignId,
      })
      .from(ads)
      .where(
        and(
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
          eq(ads.creationKey, creationKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Ads made here, written carrying our Link Tags because they went out in
   * the call that made them, and unconfirmed until read back.
   */
  private async insertCreatedAds(
    scope: MirrorScope,
    campaignId: string,
    rows: readonly CreatedAdInput[],
    at: Date,
    creationKey: string | null = null,
  ): Promise<Map<string, string>> {
    const adIds = new Map<string, string>();
    if (rows.length) {
      const written = await this.db
        .insert(ads)
        .values(
          rows.map((ad) => ({
            organizationId: scope.organizationId,
            storeId: scope.storeId,
            campaignId,
            externalId: ad.externalId,
            name: nameOr(ad.name, `Ad ${ad.externalId}`, AD_LIMITS.name),
            format: ad.format,
            status: ad.status,
            reviewStatus: ad.reviewStatus,
            creativeUrl: ad.creativeUrl,
            adSetExternalId: ad.adSetExternalId,
            creationKey,
            hasLinkTags: true,
            linkTagsCheckedAt: null,
            createdAt: at,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [ads.storeId, ads.externalId],
          set: {
            campaignId: sql`excluded.campaign_id`,
            name: sql`excluded.name`,
            format: sql`coalesce(excluded.format, ${ads.format})`,
            status: sql`excluded.status`,
            reviewStatus: sql`excluded.review_status`,
            creativeUrl: sql`coalesce(${ads.creativeUrl}, excluded.creative_url)`,
            adSetExternalId: sql`coalesce(excluded.ad_set_external_id, ${ads.adSetExternalId})`,
            creationKey: sql`coalesce(${ads.creationKey}, excluded.creation_key)`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: eq(ads.organizationId, scope.organizationId),
        })
        .returning({ id: ads.id, externalId: ads.externalId });
      for (const row of written) adIds.set(row.externalId, row.id);
    }
    return adIds;
  }

  /**
   * One Campaign in this Store, whole, and every Ad under it, or null when the
   * id is not this Store's.
   */
  async findCampaignToEdit(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<CampaignToEdit | null> {
    const [campaign] = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
        ),
      )
      .limit(1);
    if (!campaign) return null;

    const campaignAds = await this.db
      .select({
        id: ads.id,
        externalId: ads.externalId,
        name: ads.name,
        status: ads.status,
        creativeUrl: ads.creativeUrl,
        adSetExternalId: ads.adSetExternalId,
      })
      .from(ads)
      .where(
        and(
          eq(ads.campaignId, campaign.id),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
        ),
      )
      .orderBy(asc(ads.createdAt), asc(ads.id));

    return { campaign, ads: campaignAds };
  }

  /**
   * The Ad Set a new Ad joins: the one holding the Ad that has spent the
   * most, so a fresh creative goes where the campaign's money already goes.
   * With no spend anywhere, the newest Ad's. Null when no Ad of the Campaign
   * has said which Ad Set it is in.
   */
  async adSetForNewAd(
    scope: MirrorScope,
    campaignId: string,
  ): Promise<string | null> {
    const rows = await this.db.execute<{ ad_set_external_id: string }>(sql`
      SELECT a.ad_set_external_id
      FROM ${ads} AS a
      LEFT JOIN ${adDailyFigures} AS f ON f.ad_id = a.id
      WHERE a.organization_id = ${scope.organizationId}
        AND a.store_id = ${scope.storeId}
        AND a.campaign_id = ${campaignId}
        AND a.ad_set_external_id IS NOT NULL
      GROUP BY a.id
      ORDER BY coalesce(sum(f.spend), 0) DESC, a.created_at DESC, a.id DESC
      LIMIT 1
    `);
    return rows.rows[0]?.ad_set_external_id ?? null;
  }

  /**
   * Records what an edit the platform accepted changed about a Campaign, so
   * the page shows it now rather than after the next sync.
   *
   * Only ever called after the platform has said yes. A refused change never
   * reaches this, so the previous state stands.
   */
  async recordCampaignChange(
    scope: MirrorScope,
    campaignId: string,
    change: CampaignChange,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(campaigns)
      .set({ ...change, updatedAt: at })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.organizationId, scope.organizationId),
          eq(campaigns.storeId, scope.storeId),
        ),
      );
  }

  /** Records an Ad's switch, once the platform has accepted it. */
  async recordAdStatus(
    scope: MirrorScope,
    adId: string,
    status: CampaignStatus,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(ads)
      .set({ status, updatedAt: at })
      .where(
        and(
          eq(ads.id, adId),
          eq(ads.organizationId, scope.organizationId),
          eq(ads.storeId, scope.storeId),
        ),
      );
  }

  /** The Campaign a create with this key already made here, or null. */
  async findByCreationKey(
    orgId: string,
    storeId: string,
    creationKey: string,
  ): Promise<{ id: string; externalId: string } | null> {
    const [row] = await this.db
      .select({ id: campaigns.id, externalId: campaigns.externalId })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
          eq(campaigns.creationKey, creationKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * One Campaign in this Store and every Ad under it, or null when the id is
   * not this Store's. Ads come oldest first, so a merchant reads the per-ad
   * results in the order the ads were made.
   */
  async findCampaignToTrack(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<CampaignToTrack | null> {
    const [campaign] = await this.db
      .select({
        id: campaigns.id,
        externalId: campaigns.externalId,
        name: campaigns.name,
        platform: campaigns.platform,
        hasLinkTags: campaigns.hasLinkTags,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.organizationId, orgId),
          eq(campaigns.storeId, storeId),
        ),
      )
      .limit(1);
    if (!campaign) return null;

    const campaignAds = await this.db
      .select({
        id: ads.id,
        externalId: ads.externalId,
        name: ads.name,
        hasLinkTags: ads.hasLinkTags,
      })
      .from(ads)
      .where(
        and(
          eq(ads.campaignId, campaign.id),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
        ),
      )
      .orderBy(asc(ads.createdAt), asc(ads.id));

    return { ...campaign, ads: campaignAds };
  }

  /**
   * Records what reading one Ad's link tags found. Read once by the sync, then
   * left — and written again by Start tracking, once it has tagged the Ad.
   */
  async recordLinkTags(
    scope: MirrorScope,
    adId: string,
    hasLinkTags: boolean,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(ads)
      .set({ hasLinkTags, linkTagsCheckedAt: at, updatedAt: at })
      .where(
        and(
          eq(ads.id, adId),
          eq(ads.organizationId, scope.organizationId),
          eq(ads.storeId, scope.storeId),
        ),
      );
  }

  /**
   * Records the copy of an Ad's creative in our own storage — only where none
   * is recorded yet, so a second sync racing the first cannot swap one copy
   * for another.
   */
  async recordCreative(
    scope: MirrorScope,
    adId: string,
    url: string,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(ads)
      .set({ creativeUrl: url, updatedAt: at })
      .where(
        and(
          eq(ads.id, adId),
          eq(ads.organizationId, scope.organizationId),
          eq(ads.storeId, scope.storeId),
          isNull(ads.creativeUrl),
        ),
      );
  }

  /**
   * Recomputes Tracked for every Campaign on this platform: true only when the
   * Campaign has Ads and every one carries our Link Tags.
   *
   * A Campaign with no Ads is Not Tracked. Nothing it could earn would be
   * credited to it, and "Tracked" on a card is a claim that its revenue figure
   * means something.
   */
  async refreshTracked(scope: MirrorScope, at: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${campaigns} AS c
      SET has_link_tags = t.tracked, updated_at = ${at}
      FROM (
        SELECT c2.id,
               (count(a.id) > 0 AND coalesce(bool_and(a.has_link_tags), false)) AS tracked
        FROM ${campaigns} AS c2
        LEFT JOIN ${ads} AS a ON a.campaign_id = c2.id
        WHERE c2.organization_id = ${scope.organizationId}
          AND c2.store_id = ${scope.storeId}
          AND c2.platform = ${scope.platform}
        GROUP BY c2.id
      ) AS t
      WHERE c.id = t.id
        AND c.has_link_tags IS DISTINCT FROM t.tracked
    `);
  }

  /**
   * Gives each Campaign on this platform with no Cover the creative of its Ad
   * that has spent the most, where there is one.
   *
   * Only a missing Cover is filled. Once a Campaign has one it is left alone,
   * so a merchant's own choice is never overwritten by the next sync.
   */
  async fillMissingCovers(scope: MirrorScope, at: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${campaigns} AS c
      SET cover_url = pick.creative_url, updated_at = ${at}
      FROM (
        SELECT DISTINCT ON (a.campaign_id) a.campaign_id, a.creative_url
        FROM ${ads} AS a
        LEFT JOIN ${adDailyFigures} AS f ON f.ad_id = a.id
        WHERE a.organization_id = ${scope.organizationId}
          AND a.store_id = ${scope.storeId}
          AND a.creative_url IS NOT NULL
        GROUP BY a.id
        ORDER BY a.campaign_id, coalesce(sum(f.spend), 0) DESC, a.created_at ASC, a.id ASC
      ) AS pick
      WHERE c.id = pick.campaign_id
        AND c.cover_url IS NULL
        AND c.organization_id = ${scope.organizationId}
        AND c.store_id = ${scope.storeId}
        AND c.platform = ${scope.platform}
    `);
  }
}

/** A platform name, or a fallback that still says which object it is. */
function nameOr(name: string | null, fallback: string, max: number): string {
  const trimmed = name?.trim();
  return (trimmed || fallback).slice(0, max);
}
