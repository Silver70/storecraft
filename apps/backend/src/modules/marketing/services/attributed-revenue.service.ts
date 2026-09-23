import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Ad,
  AdStatus,
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';
import { resolveLookbackDays } from '../../../shared/attribution/lookback';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignRepository } from '../repositories/campaign.repository';
import {
  AttributionRepository,
  type AttributionTouch,
} from '../repositories/attribution.repository';
import { createCampaignMatcher } from '../utils/campaign-matching.util';
import { createAdMatcher } from '../utils/ad-matching.util';
import {
  resolvePeriodRange,
  type AttributionPeriod,
} from '../utils/attribution-period.util';
import {
  tallyAttributedRevenue,
  type AdTally,
  type RevenueBucket,
} from '../utils/attributed-revenue.util';

export type { AttributionTouch, AttributionPeriod };

/**
 * The figures every line of this report carries, at whatever grain it is read
 * — a Campaign, one of its Ads, or the Unassigned residue between them.
 *
 * One shape rather than three, because the arithmetic is one arithmetic: an Ad's
 * revenue is a real subdivision of the Campaign line above it, and a merchant
 * reading a split that does not add up cannot tell which half to believe.
 *
 * **There is no cost side, and its absence is deliberate.** Spend was typed in
 * by hand — one day at a time, per ad — so ROAS and Contribution Margin were
 * only ever as current as the last Tuesday the merchant remembered. All three
 * are gone until the ad platform reports the spend itself. Nothing here fills
 * the gap with a placeholder: a zero would read as "this campaign cost nothing",
 * which is a claim, and it would be false.
 */
export interface PerformanceFigures {
  orders: number;
  /**
   * Attributed revenue on the Order-total basis — tax and shipping in,
   * discounts already netted out.
   *
   * In the smallest currency unit. Never formatted here.
   */
  revenue: number;
}

/**
 * One creative's return, beneath the Campaign that funds it.
 *
 * Its revenue is the Orders whose `utm_content` resolved onto this Ad in the
 * second pass (ADR-0004). A real subdivision of the Campaign line above, never
 * an estimate of it.
 */
export interface AdRevenueLine extends PerformanceFigures {
  adId: string;
  name: string;
  /** The Ad's canonical `utm_content` value. Unique within its Campaign. */
  tag: string;
  status: AdStatus;
  /**
   * The creative, so the grid can show the picture a merchant recognises the Ad
   * by rather than making them decode its slug.
   *
   * Null is the majority state and a designed one, not a missing image: an Ad
   * under a Campaign on `email`, `sms`, `affiliate`, `influencer` or `other`
   * has no creative and never will.
   */
  creativeUrl: string | null;
  /**
   * When the creative ran, as ISO timestamps. Both optional and either may be
   * set alone — they travel with the figures so a three-day test is not read
   * naively against a month-long evergreen sitting next to it.
   */
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * The part of a Campaign no Ad of its explains.
 *
 * Revenue that matched the Campaign and none of its Ads. **Its own visible
 * bucket**, on the same principle that keeps Unattributed visible at the Store
 * level: spreading it across whichever creatives happen to exist would make
 * every one of them look better than it is.
 *
 * It is a different outcome from Unattributed, and the two are never folded
 * together. Unattributed has no Campaign at all; this has one, and it is the
 * Campaign this line sits under.
 */
export type UnassignedRevenueLine = PerformanceFigures;

export interface CampaignRevenueLine extends PerformanceFigures {
  campaignId: string;
  name: string;
  tag: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
  /**
   * How this Campaign's revenue divides across its creatives.
   *
   * Empty for a Campaign nobody has split, which is not an incomplete report:
   * an Ad is a subdivision a merchant opts into, and a Campaign without one
   * reports exactly as it did before Ads existed.
   *
   * Every figure on these lines plus the one on `unassigned` adds back up to
   * this line — the split changes nothing about the Campaign's own totals.
   */
  ads: AdRevenueLine[];
  unassigned: UnassignedRevenueLine;
}

export interface AttributedRevenueReport {
  period: AttributionPeriod;
  touch: AttributionTouch;
  /**
   * The active Lookback Window. Returned on every attributed figure so the UI
   * can show it — it is the reason these numbers differ from an ad platform's.
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

/** A Campaign nobody split, or that earned nothing: no Ads, nothing assigned. */
const NO_ADS: AdTally = { byAd: new Map(), unassigned: EMPTY };

/**
 * The Ads of one Campaign, as lines beneath it.
 *
 * The two grounds for appearing are the Campaign's own, one level down: an
 * active creative is shown even at zero, because "this variant produced
 * nothing" is exactly what a merchant splitting a push wants to find out; an
 * archived one appears only if it earned something in the period, so finished
 * creatives do not accumulate on the page forever.
 */
function adLinesFor(ads: readonly Ad[], tally: AdTally): AdRevenueLine[] {
  return ads
    .map((ad) => ({ ad, bucket: tally.byAd.get(ad.id) ?? EMPTY }))
    .filter(({ ad, bucket }) => ad.status === 'active' || bucket.orders > 0)
    .map(({ ad, bucket }) => ({
      adId: ad.id,
      name: ad.name,
      tag: ad.tag,
      status: ad.status,
      // The identity a merchant reads the line by, carried alongside the
      // figures rather than fetched a second time: the grid shows the creative
      // and the flight dates against the money, and a second read to assemble
      // one card would be free to disagree about which Ads exist.
      creativeUrl: ad.creativeUrl,
      startsAt: ad.startsAt?.toISOString() ?? null,
      endsAt: ad.endsAt?.toISOString() ?? null,
      orders: bucket.orders,
      revenue: bucket.revenue,
    }))
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.orders - a.orders ||
        a.name.localeCompare(b.name),
    );
}

/**
 * What each Campaign earned over a period — the question this feature exists to
 * answer.
 *
 * Nothing is precomputed. Every read loads the period's Orders and the Store's
 * matching rules and resolves one against the other, which is what makes a
 * Campaign created after its ads ran claim their Orders, and a corrected rule
 * repair the report rather than only changing what happens next. The cost is a
 * scan per read, traded deliberately for that correctness (ADR-0001); if it
 * ever matters, a resolved-campaign cache column is a rebuildable optimization.
 *
 * **Two grains leave here, from one read.** Each Campaign line carries the
 * split across its own Ads and the Unassigned residue between them. Both come
 * from the same tally over the same Orders as the Campaign line itself, so
 * there is one definition of the period and one calculation behind every figure
 * — a split computed by a second read would be free to disagree with the line it
 * sits under, and a merchant cannot tell which half of a contradiction to
 * believe.
 */
@Injectable()
export class AttributedRevenueService {
  private readonly lookbackDays: number;

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly ads: AdRepository,
    private readonly attribution: AttributionRepository,
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
    touch: AttributionTouch,
  ): Promise<AttributedRevenueReport> {
    const { start, end } = resolvePeriodRange(period);

    // Tenancy is enforced on all five reads. Both matchers are pure and will
    // faithfully match whatever rules they are handed, so a Store's rules never
    // meeting another Store's orders is a property of this method.
    const [campaignRows, rules, adRows, adRules, orderRows] = await Promise.all(
      [
        this.campaigns.findMany(orgId, storeId),
        this.campaigns.findMatchableRules(orgId, storeId),
        this.ads.findManyForStore(orgId, storeId),
        this.ads.findMatchableAdRules(orgId, storeId),
        this.attribution.findAttributableOrders(
          orgId,
          storeId,
          touch,
          start,
          end,
        ),
      ],
    );

    // Two matchers, two passes, one tally (ADR-0004). The Campaign matcher runs
    // exactly as it did before Ads existed and decides the Campaign alone; the
    // Ad matcher is then asked for a creative *within* that Campaign, and can
    // reach nothing outside it. Both resolve at read time, so an Ad created
    // today claims the Orders its links already produced.
    const campaignMatcher = createCampaignMatcher(rules);
    const adMatcher = createAdMatcher(adRules);

    const tally = tallyAttributedRevenue(
      orderRows,
      campaignMatcher,
      adMatcher,
      this.lookbackDays,
    );

    // The Ads themselves, grouped so each Campaign line can name the creatives
    // its split is made of. Distinct from `tally.adsByCampaign`, which holds
    // what those creatives *earned*.
    const adRowsByCampaign = new Map<string, Ad[]>();
    for (const ad of adRows) {
      const siblings = adRowsByCampaign.get(ad.campaignId);
      if (siblings) siblings.push(ad);
      else adRowsByCampaign.set(ad.campaignId, [ad]);
    }

    // Two reasons to appear. An active Campaign appears at zero, because "this
    // push produced nothing" is exactly what a merchant is reading the report to
    // find out; an archived one appears only while it still explains orders in
    // the period, so the page does not fill up with history.
    const campaigns = campaignRows
      .map((campaign) => ({
        campaign,
        bucket: tally.byCampaign.get(campaign.id) ?? EMPTY,
        ads: tally.adsByCampaign.get(campaign.id) ?? NO_ADS,
      }))
      .filter(
        ({ campaign, bucket }) =>
          campaign.status === 'active' || bucket.orders > 0,
      )
      .map(({ campaign, bucket, ads }) => ({
        campaignId: campaign.id,
        name: campaign.name,
        tag: campaign.tag,
        platform: campaign.platform,
        status: campaign.status,
        orders: bucket.orders,
        revenue: bucket.revenue,
        ads: adLinesFor(adRowsByCampaign.get(campaign.id) ?? [], ads),
        // The residue at both grains, from the same tally: revenue this
        // Campaign earned that no Ad of its claimed. Its own line, never
        // divided among the Ads above it — which is what makes those Ads plus
        // this line add back up to the Campaign's own figures.
        unassigned: ads.unassigned,
      }))
      .sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.orders - a.orders ||
          a.name.localeCompare(b.name),
      );

    return {
      period,
      touch,
      lookbackDays: this.lookbackDays,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      campaigns,
      // Summed from the lines the report actually shows, so the totals on
      // screen are the totals of what is on screen.
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
