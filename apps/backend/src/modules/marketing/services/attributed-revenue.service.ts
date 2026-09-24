import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Ad,
  AdFormat,
  AdReviewStatus,
  AdStatus,
  Campaign,
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';
import { resolveLookbackDays } from '../../../shared/attribution/lookback';
import { StoreService } from '../../tenant/services/store.service';
import { dayInTimezone } from '../../ad-platform/utils/sync-window.util';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignRepository } from '../repositories/campaign.repository';
import { AttributionRepository } from '../repositories/attribution.repository';
import {
  AdDailyFigureRepository,
  type AdFigures,
  type AdLifetime,
} from '../repositories/ad-daily-figure.repository';
import {
  resolveCampaignPeriodRange,
  resolvePeriodRange,
  type AttributionPeriod,
  type CampaignPeriod,
} from '../utils/attribution-period.util';
import {
  campaignRatios,
  roas,
  type CampaignRatios,
} from '../utils/campaign-performance.util';
import {
  creditFor,
  tallyAttributedRevenue,
  type AdTally,
  type AttributionTally,
  type CreditIndex,
  type RevenueBucket,
} from '../utils/attributed-revenue.util';
import { coverFor, endedAtFor } from '../utils/campaign-card.util';

export type { AttributionPeriod, CampaignPeriod };

/**
 * What the ad platform measured, summed over the period: what it charged, how
 * many times it showed the Ad, and how many people followed the link. Labelled
 * as the platform's measurements wherever they are shown, beside the revenue
 * that is ours.
 */
export type PlatformFigures = AdFigures;

/**
 * One creative's line, beneath the Campaign that funds it.
 *
 * Its revenue is the Orders whose credited Touch named this Ad's platform id —
 * a real subdivision of the Campaign line above, never an estimate of it.
 */
export interface AdRevenueLine extends RevenueBucket, PlatformFigures {
  adId: string;
  /** The platform's ad id — what `utm_content` carries on a click. */
  externalId: string;
  name: string;
  format: AdFormat | null;
  status: AdStatus;
  /**
   * The platform's review verdict, beside the collapsed status rather than
   * inside it — so an Ad paused after a rejection reads as both.
   */
  reviewStatus: AdReviewStatus | null;
  creativeUrl: string | null;
  hasLinkTags: boolean;
}

/**
 * The part of a Campaign's revenue no Ad of its explains: Orders that named the
 * Campaign and none of its Ads, which only a hand-edited link produces.
 *
 * **Its own line**, never spread across the Ads that exist, and never folded
 * into Unattributed — these Orders have a Campaign, and it is the one this line
 * sits under. Revenue and orders only: spend is always an Ad's, so there is no
 * spend here to report.
 */
export type UnassignedRevenueLine = RevenueBucket;

export interface CampaignRevenueLine extends RevenueBucket, PlatformFigures {
  campaignId: string;
  /** The platform's campaign id — what `utm_campaign` carries on a click. */
  externalId: string;
  name: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  /**
   * The picture the Campaign is shown with: its own Cover, or failing that the
   * creative of its Ad that has spent the most. Null only when no Ad has a
   * creative on file.
   */
  coverUrl: string | null;
  /**
   * When an Ended Campaign stopped — its scheduled end once passed, otherwise
   * the last day any of its Ads reported a figure. Null for a Campaign that has
   * not ended, and for one that ended without ever reporting a figure.
   *
   * Over the Campaign's whole life, not the period, so the grid can tell a
   * campaign that finished last week from one that finished last year.
   */
  endedAt: string | null;
  /**
   * Tracked when true. When false the Campaign's revenue is **unknown, not
   * zero** — its Ads carry no Link Tags, so no Order could name them — and a
   * reader must show it as such rather than print the zero below.
   */
  hasLinkTags: boolean;
  /**
   * Every Ad of the Campaign. Their revenue and orders plus `unassigned` add
   * back up to this line exactly; their platform figures add up to it on their
   * own.
   */
  ads: AdRevenueLine[];
  unassigned: UnassignedRevenueLine;
}

export interface AttributedRevenueReport {
  period: AttributionPeriod;
  /**
   * The active Lookback Window. Returned on every attributed figure so the UI
   * can show it — it is one reason these numbers differ from an ad platform's.
   */
  lookbackDays: number;
  /** The `[start, end)` actually read, so the UI can name the period exactly. */
  rangeStart: string;
  rangeEnd: string;
  campaigns: CampaignRevenueLine[];
  /**
   * Every Campaign line summed. Unattributed is not part of it — it has no
   * Campaign to belong to.
   */
  blended: RevenueBucket;
  /** Its own line. Never redistributed across the campaigns above. */
  unattributed: RevenueBucket;
  /** Attributed plus unattributed — the period's realized revenue. */
  totals: RevenueBucket;
}

/** One Ad's row on its Campaign's page: its report line, and its ROAS. */
export interface AdPerformanceLine extends AdRevenueLine {
  /** Null when the Ad spent nothing, or its revenue cannot be read. */
  roas: number | null;
}

/**
 * One Campaign over a period, with every figure its page shows.
 *
 * The same line the Store-wide report carries — the same tally, the same Ads,
 * the same Unassigned residue — so the page and the grid cannot disagree about
 * a Campaign they both show. The ratios on top follow
 * `campaign-performance.util`, which is where each one's reason to be absent is
 * written.
 */
export interface CampaignPerformanceLine
  extends Omit<CampaignRevenueLine, 'ads'>, CampaignRatios {
  ads: AdPerformanceLine[];
  /**
   * Why Contribution Margin and ROI are absent, when it is missing cost
   * prices: every product sold in the period without one, once each.
   * Empty when every item was costed, or when the Campaign is Not Tracked.
   */
  uncostedProducts: { productId: string | null; name: string }[];
}

export interface CampaignPerformanceReport {
  period: CampaignPeriod;
  /** The Lookback Window, stated once where the figures are read. */
  lookbackDays: number;
  /** The first instant read, or null for Lifetime, which has no start. */
  rangeStart: string | null;
  rangeEnd: string;
  campaign: CampaignPerformanceLine;
}

const EMPTY: RevenueBucket = { orders: 0, revenue: 0 };
const NO_FIGURES: PlatformFigures = { spend: 0, impressions: 0, clicks: 0 };
const NO_ADS: AdTally = { byAd: new Map(), unassigned: EMPTY };

function sumFigures(lines: readonly PlatformFigures[]): PlatformFigures {
  return lines.reduce<PlatformFigures>(
    (sum, line) => ({
      spend: sum.spend + line.spend,
      impressions: sum.impressions + line.impressions,
      clicks: sum.clicks + line.clicks,
    }),
    NO_FIGURES,
  );
}

const byRevenue = <T extends RevenueBucket & { name: string }>(a: T, b: T) =>
  b.revenue - a.revenue || b.orders - a.orders || a.name.localeCompare(b.name);

function adLinesFor(
  ads: readonly Ad[],
  tally: AdTally,
  figures: ReadonlyMap<string, AdFigures>,
): AdRevenueLine[] {
  return ads
    .map((ad) => {
      const bucket = tally.byAd.get(ad.id) ?? EMPTY;
      return {
        adId: ad.id,
        externalId: ad.externalId,
        name: ad.name,
        format: ad.format,
        status: ad.status,
        reviewStatus: ad.reviewStatus,
        creativeUrl: ad.creativeUrl,
        hasLinkTags: ad.hasLinkTags,
        orders: bucket.orders,
        revenue: bucket.revenue,
        ...(figures.get(ad.id) ?? NO_FIGURES),
      };
    })
    .sort(byRevenue);
}

/**
 * One Campaign's report line from rows already read: its credit, its Ads'
 * split of it, and the platform's figures summed up from those Ads.
 */
function campaignLineFor(
  campaign: Campaign,
  ownAds: readonly Ad[],
  tally: AttributionTally,
  figures: ReadonlyMap<string, AdFigures>,
  lifetime: ReadonlyMap<string, AdLifetime>,
  end: Date,
): CampaignRevenueLine {
  const bucket = tally.byCampaign.get(campaign.id) ?? EMPTY;
  const adTally = tally.adsByCampaign.get(campaign.id) ?? NO_ADS;
  const endedAt = endedAtFor(campaign, ownAds, lifetime, end);
  const ads = adLinesFor(ownAds, adTally, figures);
  return {
    campaignId: campaign.id,
    externalId: campaign.externalId,
    name: campaign.name,
    platform: campaign.platform,
    status: campaign.status,
    startsAt: campaign.startsAt?.toISOString() ?? null,
    endsAt: campaign.endsAt?.toISOString() ?? null,
    coverUrl: coverFor(campaign.coverUrl, ownAds, lifetime),
    endedAt: endedAt?.toISOString() ?? null,
    hasLinkTags: campaign.hasLinkTags,
    orders: bucket.orders,
    revenue: bucket.revenue,
    // A Campaign's platform figures are its Ads' summed — there is no
    // campaign-level figure to disagree with them.
    ...sumFigures(ads),
    ads,
    unassigned: adTally.unassigned,
  };
}

/**
 * What each Campaign earned over a period, and what the platform says it cost.
 *
 * Nothing is precomputed. Every read loads the period's Orders and the Store's
 * Campaigns and Ads, and credits each Order by the latest-ad-click rule in
 * `attributed-revenue.util` — the only place that rule exists. The join is the
 * platform's own ids, so a Campaign discovered after its ads ran still claims
 * the Orders they drove.
 *
 * **Two grains leave here, from one read.** Each Campaign line carries the
 * split across its own Ads and the Unassigned residue between them, from the
 * same tally over the same Orders, so the split can never disagree with the
 * line it sits under.
 */
@Injectable()
export class AttributedRevenueService {
  private readonly lookbackDays: number;

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly ads: AdRepository,
    private readonly attribution: AttributionRepository,
    private readonly figures: AdDailyFigureRepository,
    private readonly stores: StoreService,
    config: ConfigService,
  ) {
    this.lookbackDays = resolveLookbackDays(
      config.get('ATTRIBUTION_LOOKBACK_DAYS'),
    );
  }

  async byCampaign(
    orgId: string,
    storeId: string,
    period: AttributionPeriod,
  ): Promise<AttributedRevenueReport> {
    const { start, end } = resolvePeriodRange(period);

    // The platform dates its figures by the ad account's day, which is the
    // Store's; read the same calendar days the period covers there.
    const store = await this.stores.findById(storeId, orgId);
    const timezone = store?.timezone ?? 'UTC';

    // Tenancy is enforced on every read. The credit rule is pure and will
    // faithfully match whatever index it is handed, so a Store's Campaigns
    // never meeting another Store's Orders is a property of this method.
    const [campaignRows, adRows, orderRows, figures, lifetime] =
      await Promise.all([
        this.campaigns.findMany(orgId, storeId),
        this.ads.findManyForStore(orgId, storeId),
        this.attribution.findAttributableOrders(orgId, storeId, start, end),
        this.figures.sumByAd(
          orgId,
          storeId,
          dayInTimezone(start, timezone),
          dayInTimezone(end, timezone),
        ),
        this.figures.lifetimeByAd(orgId, storeId),
      ]);

    const index: CreditIndex = {
      campaigns: new Map(campaignRows.map((c) => [c.externalId, c.id])),
      ads: new Map(
        adRows.map((a) => [
          a.externalId,
          { adId: a.id, campaignId: a.campaignId },
        ]),
      ),
    };

    const tally = tallyAttributedRevenue(orderRows, index, this.lookbackDays);

    const adRowsByCampaign = new Map<string, Ad[]>();
    for (const ad of adRows) {
      const siblings = adRowsByCampaign.get(ad.campaignId);
      if (siblings) siblings.push(ad);
      else adRowsByCampaign.set(ad.campaignId, [ad]);
    }

    const campaigns: CampaignRevenueLine[] = campaignRows
      .map((campaign) =>
        campaignLineFor(
          campaign,
          adRowsByCampaign.get(campaign.id) ?? [],
          tally,
          figures,
          lifetime,
          end,
        ),
      )
      .sort(byRevenue);

    return {
      period,
      lookbackDays: this.lookbackDays,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      campaigns,
      blended: campaigns.reduce<RevenueBucket>(
        (sum, line) => ({
          orders: sum.orders + line.orders,
          revenue: sum.revenue + line.revenue,
        }),
        { orders: 0, revenue: 0 },
      ),
      unattributed: tally.unattributed,
      totals: tally.totals,
    };
  }
  /**
   * One Campaign's page: its line over the period, its Ads' ROAS, and the
   * ratios and margin the Store-wide report does not carry.
   *
   * Reads only what is stored — the Orders, the Campaign and Ad rows, and the
   * platform figures the sync already wrote. Nothing here calls the platform,
   * so a vendor outage costs this page freshness and never the page.
   *
   * Only the Orders naming this Campaign are read, but they are credited with
   * the whole Store's index: an Order whose first Touch names this Campaign
   * and whose last Touch names another belongs to the other one, and only the
   * full index knows that.
   */
  async forCampaign(
    orgId: string,
    storeId: string,
    campaignId: string,
    period: CampaignPeriod,
  ): Promise<CampaignPerformanceReport> {
    const campaign = await this.campaigns.findById(campaignId, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');

    const { start, end } = resolveCampaignPeriodRange(period);
    const store = await this.stores.findById(storeId, orgId);
    const timezone = store?.timezone ?? 'UTC';

    const [campaignRows, adRows, orderRows, figures, lifetime] =
      await Promise.all([
        this.campaigns.findMany(orgId, storeId),
        this.ads.findManyForStore(orgId, storeId),
        this.attribution.findOrdersNamingCampaign(
          orgId,
          storeId,
          campaign.externalId,
          start,
          end,
        ),
        this.figures.sumByAd(
          orgId,
          storeId,
          dayInTimezone(start, timezone),
          dayInTimezone(end, timezone),
        ),
        this.figures.lifetimeByAd(orgId, storeId),
      ]);

    const index: CreditIndex = {
      campaigns: new Map(campaignRows.map((c) => [c.externalId, c.id])),
      ads: new Map(
        adRows.map((a) => [
          a.externalId,
          { adId: a.id, campaignId: a.campaignId },
        ]),
      ),
    };

    const credited = orderRows.filter(
      (order) =>
        creditFor(order, index, this.lookbackDays)?.campaignId === campaign.id,
    );
    const tally = tallyAttributedRevenue(credited, index, this.lookbackDays);
    const line = campaignLineFor(
      campaign,
      adRows.filter((ad) => ad.campaignId === campaign.id),
      tally,
      figures,
      lifetime,
      end,
    );

    // A Not Tracked Campaign's margin is withheld for a better reason than
    // missing costs, so its goods are not read and none are listed as owed.
    const goods = campaign.hasLinkTags
      ? await this.attribution.goodsCost(
          orgId,
          storeId,
          credited.map((order) => order.id),
        )
      : { cost: 0, uncostedItems: 0, uncostedProducts: [] };

    return {
      period,
      lookbackDays: this.lookbackDays,
      rangeStart: period === 'lifetime' ? null : start.toISOString(),
      rangeEnd: end.toISOString(),
      campaign: {
        ...line,
        ...campaignRatios({
          tracked: campaign.hasLinkTags,
          revenue: line.revenue,
          orders: line.orders,
          spend: line.spend,
          clicks: line.clicks,
          goods,
        }),
        ads: line.ads.map((ad) => ({
          ...ad,
          // An Ad can carry our tags inside a Campaign that is Not Tracked as
          // a whole, and then its own revenue is readable.
          roas: ad.hasLinkTags ? roas(ad.revenue, ad.spend) : null,
        })),
        uncostedProducts: goods.uncostedProducts,
      },
    };
  }
}
