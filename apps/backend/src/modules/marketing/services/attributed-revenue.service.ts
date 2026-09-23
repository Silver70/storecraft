import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Ad,
  AdFormat,
  AdStatus,
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
} from '../repositories/ad-daily-figure.repository';
import {
  resolvePeriodRange,
  type AttributionPeriod,
} from '../utils/attribution-period.util';
import {
  tallyAttributedRevenue,
  type AdTally,
  type CreditIndex,
  type RevenueBucket,
} from '../utils/attributed-revenue.util';

export type { AttributionPeriod };

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
  coverUrl: string | null;
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
    const [campaignRows, adRows, orderRows, figures] = await Promise.all([
      this.campaigns.findMany(orgId, storeId),
      this.ads.findManyForStore(orgId, storeId),
      this.attribution.findAttributableOrders(orgId, storeId, start, end),
      this.figures.sumByAd(
        orgId,
        storeId,
        dayInTimezone(start, timezone),
        dayInTimezone(end, timezone),
      ),
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
      .map((campaign) => {
        const bucket = tally.byCampaign.get(campaign.id) ?? EMPTY;
        const ads = adLinesFor(
          adRowsByCampaign.get(campaign.id) ?? [],
          tally.adsByCampaign.get(campaign.id) ?? NO_ADS,
          figures,
        );
        return {
          campaignId: campaign.id,
          externalId: campaign.externalId,
          name: campaign.name,
          platform: campaign.platform,
          status: campaign.status,
          startsAt: campaign.startsAt?.toISOString() ?? null,
          endsAt: campaign.endsAt?.toISOString() ?? null,
          coverUrl: campaign.coverUrl,
          hasLinkTags: campaign.hasLinkTags,
          orders: bucket.orders,
          revenue: bucket.revenue,
          // A Campaign's platform figures are its Ads' summed — there is no
          // campaign-level figure to disagree with them.
          ...sumFigures(ads),
          ads,
          unassigned: (tally.adsByCampaign.get(campaign.id) ?? NO_ADS)
            .unassigned,
        };
      })
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
}
