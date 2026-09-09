import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Ad,
  AdStatus,
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';
import { resolveLookbackDays } from '../../../shared/attribution/lookback';
import { pct } from '../../../shared/utils/percent.util';
import { StoreService } from '../../tenant/services/store.service';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignRepository } from '../repositories/campaign.repository';
import { CampaignSpendRepository } from '../repositories/campaign-spend.repository';
import { TrafficRepository } from '../repositories/traffic.repository';
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
  type GoodsBucket,
  type RevenueBucket,
} from '../utils/attributed-revenue.util';
import { spendDayRange } from '../utils/spend-day.util';
import {
  measuredTrafficFor,
  tallyVisitors,
  type MeasuredTraffic,
} from '../utils/traffic.util';
import {
  blendPerformance,
  roasFor,
  type BlendedPerformance,
} from '../utils/performance.util';
import {
  blendMargin,
  marginFor,
  NO_GOODS,
  type CampaignMargin,
  type MarginInput,
} from '../utils/margin.util';

export type { AttributionTouch, AttributionPeriod };

/**
 * The figures every line of this report carries, at whatever grain it is read
 * — a Campaign, one of its Ads, or the Unassigned residue between them.
 *
 * One shape rather than three, because the arithmetic is one arithmetic. A
 * per-Ad ROAS computed a second way would be free to disagree with the Campaign
 * ROAS above it, and a merchant reading a split that does not add up cannot
 * tell which half to believe.
 */
export interface PerformanceFigures extends MarginInput, CampaignMargin {
  orders: number;
  /**
   * Attributed revenue on the **Order-total basis** — what Stage 1 reported and
   * what ROAS divides. It includes tax and shipping and has discounts already
   * netted out, which is why Contribution Margin is not built on it: see
   * `goodsRevenue` beside it and `margin.util`.
   *
   * In the smallest currency unit. Never formatted here.
   */
  revenue: number;
  /**
   * Spend recorded for the period, in the smallest currency unit. Zero for a
   * line nobody recorded a cost against.
   *
   * Declared on `MarginInput`, named here because it is one of the two figures
   * the ratio beside it divides.
   */
  spend: number;
  /**
   * Revenue over Spend, to two decimal places. A **ratio**, not money — 4.25
   * means $4.25 back per dollar spent — so the integer-cents rule does not
   * apply to it. Null when nothing was spent: see `roasFor`.
   */
  roas: number | null;
}

/**
 * One creative's return, beneath the Campaign that funds it.
 *
 * Its revenue is the Orders whose `utm_content` resolved onto this Ad in the
 * second pass (ADR-0004); its Spend is the rows recorded against this Ad alone.
 * Both are real subdivisions of the Campaign line above, never estimates of it.
 */
export interface AdRevenueLine extends PerformanceFigures {
  adId: string;
  name: string;
  /** The Ad's canonical `utm_content` value. Unique within its Campaign. */
  tag: string;
  status: AdStatus;
  /**
   * The creative, so the card grid can show the picture a merchant recognises
   * the Ad by rather than making them decode its slug.
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
  /**
   * Who this creative was *seen* by, from the event stream — the one figure on
   * this line that Orders cannot tell us, and the one a merchant needs to
   * separate a creative nobody clicked from one that was clicked and did not
   * convert.
   *
   * It is nested rather than flattened alongside the rest **so that the UI
   * cannot render it identically by accident**. Everything else on this line is
   * derived from money that changed hands; this comes from a script that an ad
   * blocker can suppress and the retention purge eventually deletes. Null when
   * the stream holds nothing for this Ad — absent, never zero.
   */
  measured: MeasuredTraffic | null;
}

/**
 * The part of a Campaign no Ad of its explains.
 *
 * Revenue that matched the Campaign and none of its Ads, and Spend recorded
 * against the Campaign without naming one. **Its own visible bucket**, on the
 * same principle that keeps Unattributed visible at the Store level: spreading
 * it across whichever creatives happen to exist would make every one of them
 * look better than it is.
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
   * How this Campaign's period divides across its creatives.
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
  /**
   * The same measured pair one grain up: distinct visitors the stream saw on
   * this Campaign's tag, whichever creative they arrived through.
   *
   * **Not the sum of its Ads' visitors, and not meant to be.** A visitor who
   * clicked two of them is one person here and a visitor of both there.
   * Revenue subdivides because an Order belongs to exactly one Ad; an audience
   * overlaps because a person does not — which is also why `unassigned` carries
   * no measured pair. A residue invites a subtraction, and there is none that
   * holds.
   */
  measured: MeasuredTraffic | null;
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
   * The inclusive calendar day range Spend was counted over, in the Store's
   * timezone. Spend is recorded per day while revenue is recorded to the
   * second, so the two windows are named separately rather than implied.
   */
  spendFrom: string;
  spendTo: string;
  /**
   * Every Campaign line summed, with the ROAS and the Contribution Margin of
   * the sums. Unattributed is not part of it — nobody spent against a bucket
   * that has no Campaign.
   */
  blended: BlendedPerformance & MarginInput & CampaignMargin;
  /** Its own line. Never redistributed across the campaigns above. */
  unattributed: RevenueBucket;
  /** Attributed plus unattributed — the period's realized revenue. */
  totals: RevenueBucket;
}

/**
 * The whole account in one read — what was spent, what came back, and the ratio
 * between them, with the caveat that qualifies it.
 *
 * Derived from the report rather than computed a second way. Everything here is
 * a field of `AttributedRevenueReport` or a share of two of them, which is the
 * point: a card on the dashboard and the report it links to disagreeing about
 * what was spent this week would discredit both, and there is no arithmetic in
 * this shape that could drift.
 */
export interface MarketingSummary {
  period: AttributionPeriod;
  touch: AttributionTouch;
  /** The active Lookback Window — the reason these figures differ from an ad platform's. */
  lookbackDays: number;
  /** The `[start, end)` revenue was read over. */
  rangeStart: string;
  rangeEnd: string;
  /** The inclusive calendar days Spend was counted over, in the Store's timezone. */
  spendFrom: string;
  spendTo: string;
  /** Total Spend across every Campaign for the period, in the smallest currency unit. */
  spend: number;
  /**
   * Attributed revenue on the Order-total basis — the same `blended.revenue`
   * the report shows, and what the blended ROAS divides.
   */
  revenue: number;
  /** Revenue over Spend, to two decimal places. A ratio, not money. Null when nothing was spent. */
  roas: number | null;
  /** Attributed plus unattributed: the period's realized revenue. */
  realizedRevenue: number;
  /** The revenue no Campaign explains. Never folded into the figures above it. */
  unattributedRevenue: number;
  /**
   * Unattributed as a whole-number share of realized revenue. **Display only**,
   * on the same `pct` convention as every other reported percentage.
   *
   * It travels beside the ROAS because it is the caveat on it: a blended ROAS
   * computed over 30% of a Store's revenue is not wrong, but read without this
   * number it looks like an account-wide verdict when it is a minority report.
   */
  unattributedPct: number;
  /**
   * Whether this Store has ever recorded Spend at all.
   *
   * The difference between "you have not set this up" and "this period cost
   * nothing", which a period total of zero cannot express. The card says
   * different things for the two, and saying the wrong one either nags a
   * merchant who is already recording their costs or leaves one who is not
   * staring at a $0.00 that looks broken.
   */
  spendEverRecorded: boolean;
}

const EMPTY: RevenueBucket = { orders: 0, revenue: 0 };

/** A Campaign nobody split, or that earned nothing: no Ads, nothing assigned. */
const NO_ADS: AdTally = {
  byAd: new Map(),
  goodsByAd: new Map(),
  unassigned: EMPTY,
  unassignedGoods: NO_GOODS,
};

/**
 * One line of the report, from the three things a line is made of: what it
 * earned, the goods behind that, and what it cost.
 *
 * Every grain goes through here — Campaign, Ad and Unassigned alike — so ROAS
 * and Contribution Margin mean exactly one thing on this report and the null
 * semantics are the same wherever a merchant reads them: no ROAS without Spend
 * rather than a zero, and no margin without cost coverage rather than a
 * fiction.
 */
function figuresFor(
  bucket: RevenueBucket,
  goods: GoodsBucket,
  spend: number,
): PerformanceFigures {
  return {
    orders: bucket.orders,
    revenue: bucket.revenue,
    spend,
    roas: roasFor(bucket.revenue, spend),
    ...goods,
    ...marginFor({ ...goods, spend }),
  };
}

/**
 * The Ads of one Campaign, as lines beneath it.
 *
 * The three grounds for appearing are the Campaign's own, one level down: an
 * active creative is shown even at zero, because "this variant produced
 * nothing" is exactly what a merchant splitting a push wants to find out; an
 * archived one appears only if it earned or cost something in the period, so
 * finished creatives do not accumulate on the page forever.
 *
 * Sorted as the Campaigns are, and for the same reason: Spend breaks the tie
 * before order count, so among the creatives that earned nothing the ones
 * burning money sort above the ones that are merely idle.
 */
function adLinesFor(
  ads: readonly Ad[],
  tally: AdTally,
  spendByAd: ReadonlyMap<string, number>,
  visitorsByAd: ReadonlyMap<string, number>,
): AdRevenueLine[] {
  return ads
    .map((ad) => ({
      ad,
      bucket: tally.byAd.get(ad.id) ?? EMPTY,
      goods: tally.goodsByAd.get(ad.id) ?? NO_GOODS,
      spend: spendByAd.get(ad.id) ?? 0,
    }))
    .filter(
      ({ ad, bucket, spend }) =>
        ad.status === 'active' || bucket.orders > 0 || spend > 0,
    )
    .map(({ ad, bucket, goods, spend }) => ({
      adId: ad.id,
      name: ad.name,
      tag: ad.tag,
      status: ad.status,
      // The identity a merchant reads the line by, carried alongside the
      // figures rather than fetched a second time: the card grid shows the
      // creative and the flight dates against the money, and a second read to
      // assemble one card would be free to disagree about which Ads exist.
      creativeUrl: ad.creativeUrl,
      startsAt: ad.startsAt?.toISOString() ?? null,
      endsAt: ad.endsAt?.toISOString() ?? null,
      ...figuresFor(bucket, goods, spend),
      // The measured pair, kept in its own object beside the order-derived
      // figures rather than spread among them. `bucket.orders` is the
      // numerator: the purchases this creative actually earned, counted in
      // full, over only the visitors the tracker managed to see.
      measured: measuredTrafficFor(visitorsByAd.get(ad.id), bucket.orders),
    }))
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.spend - a.spend ||
        b.orders - a.orders ||
        a.name.localeCompare(b.name),
    );
}

/**
 * What each Campaign returned for a period, and what it cost — the question
 * this whole feature exists to answer.
 *
 * Nothing is precomputed. Every read loads the period's Orders and the Store's
 * matching rules and resolves one against the other, which is what makes a
 * Campaign created after its ads ran claim their Orders, and a corrected rule
 * repair the report rather than only changing what happens next. The cost is a
 * scan per read, traded deliberately for that correctness (ADR-0001); if it
 * ever matters, a resolved-campaign cache column is a rebuildable optimization.
 *
 * **Revenue is untouched by the cost figures.** It is still the Order-total
 * basis Stage 1 reported, computed by the same tally over the same rows, so the
 * two stages reconcile and adding Spend moves nobody's revenue numbers. Spend
 * is read alongside it and divided into it; it is never subtracted from it.
 *
 * **Two revenue bases leave here, and both are correct.** `revenue` is the
 * Order total — tax and shipping in, discounts already out — and is what ROAS
 * divides. `goodsRevenue` is the goods alone, before discount, and is what
 * Contribution Margin is built on. They are not the same number and nothing
 * here pretends otherwise; naming which is which is the caller's job, and the
 * report page does it on screen.
 *
 * **Two grains leave here, from one read.** Each Campaign line carries the
 * split across its own Ads and the Unassigned residue between them. Both come
 * from the same tally over the same Orders and the same Spend read as the
 * Campaign line itself, so there is one definition of the period and one
 * calculation behind every figure — a split computed by a second read would be
 * free to disagree with the line it sits under, and a merchant cannot tell
 * which half of a contradiction to believe.
 */
@Injectable()
export class AttributedRevenueService {
  private readonly lookbackDays: number;

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly ads: AdRepository,
    private readonly attribution: AttributionRepository,
    private readonly spend: CampaignSpendRepository,
    private readonly traffic: TrafficRepository,
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
    touch: AttributionTouch,
  ): Promise<AttributedRevenueReport> {
    const { start, end } = resolvePeriodRange(period);

    // Spend is a calendar date and revenue is an instant, so the period has to
    // be read as days as well. Converted from the same `[start, end)` the
    // orders are read over rather than resolved a second way: two definitions
    // of "the last 30 days" that disagreed by an hour would make a Campaign's
    // Spend and its revenue describe different windows, and the ratio between
    // them would be wrong in a way nothing could detect.
    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');
    const { from, to } = spendDayRange(start, end, store.timezone);

    // Tenancy is enforced on all seven reads. Both matchers are pure and will
    // faithfully match whatever rules they are handed, so a Store's rules never
    // meeting another Store's orders is a property of this method.
    const [
      campaignRows,
      rules,
      adRows,
      adRules,
      orderRows,
      spendTotals,
      visitorRows,
    ] = await Promise.all([
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
      this.spend.sumByGrain(orgId, storeId, from, to),
      // The measured half of the report, over the same `[start, end)` the
      // Orders are read over — one period governs the page, so a visitor
      // figure and the purchases beside it are never from two windows. It is
      // read last and used least: nothing below depends on it, so a Store with
      // no tracker embedded gets exactly the report it got before.
      this.traffic.findTaggedVisitors(orgId, storeId, start, end),
    ]);

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

    // The event stream through the *same* two matchers over the *same* rules.
    // A second resolution built for traffic would be free to disagree with the
    // one the money went through, and a creative whose revenue and whose
    // visitors were resolved by different rules is worse than one with no
    // visitors at all. The Lookback Window is not applied here and cannot be:
    // it measures backwards from an Order, and a visit that never became one
    // has nothing to measure from.
    const visitors = tallyVisitors(visitorRows, campaignMatcher, adMatcher);

    // The Ads themselves, grouped so each Campaign line can name the creatives
    // its split is made of. Distinct from `tally.adsByCampaign`, which holds
    // what those creatives *earned*.
    const adRowsByCampaign = new Map<string, Ad[]>();
    for (const ad of adRows) {
      const siblings = adRowsByCampaign.get(ad.campaignId);
      if (siblings) siblings.push(ad);
      else adRowsByCampaign.set(ad.campaignId, [ad]);
    }

    // Three reasons to appear, and the third is the point of the cost report:
    // an archived Campaign that quietly spent money in the period must not
    // vanish from it. Archived and silent, it stays out — it keeps explaining
    // the orders it drove without cluttering the report forever. An active one
    // appears at zero, because "this push produced nothing" is exactly what a
    // merchant is reading the report to find out.
    const campaigns = campaignRows
      .map((campaign) => ({
        campaign,
        bucket: tally.byCampaign.get(campaign.id) ?? EMPTY,
        // The same read-time matching produced both buckets in the same pass,
        // so a Campaign's margin arrives exactly when its revenue does.
        goods: tally.goodsByCampaign.get(campaign.id) ?? NO_GOODS,
        ads: tally.adsByCampaign.get(campaign.id) ?? NO_ADS,
        spend: spendTotals.byCampaign.get(campaign.id) ?? 0,
      }))
      .filter(({ campaign, bucket, spend }) => {
        return campaign.status === 'active' || bucket.orders > 0 || spend > 0;
      })
      .map(({ campaign, bucket, goods, ads, spend: campaignSpend }) => ({
        campaignId: campaign.id,
        name: campaign.name,
        tag: campaign.tag,
        platform: campaign.platform,
        status: campaign.status,
        // Both bases travel to the caller. They are different numbers and the
        // page has to name which is which rather than leave a merchant to
        // notice that ROAS and margin do not reconcile.
        ...figuresFor(bucket, goods, campaignSpend),
        measured: measuredTrafficFor(
          visitors.byCampaign.get(campaign.id),
          bucket.orders,
        ),
        ads: adLinesFor(
          adRowsByCampaign.get(campaign.id) ?? [],
          ads,
          spendTotals.byAd,
          visitors.byAd,
        ),
        // The residue at both grains, from the same tally and the same spend
        // read: revenue this Campaign earned that no Ad of its claimed, and
        // cost recorded against the Campaign without naming one. Its own line,
        // never divided among the Ads above it — which is what makes those Ads
        // plus this line add back up to the Campaign's own figures.
        unassigned: figuresFor(
          ads.unassigned,
          ads.unassignedGoods,
          spendTotals.unsplitByCampaign.get(campaign.id) ?? 0,
        ),
      }))
      // Spend breaks the tie before order count does, so among the lines that
      // earned nothing the ones burning money sort above the ones that are
      // merely idle. That row is the most actionable in an ad account and it
      // should not be found at the bottom of a list of empty Campaigns.
      .sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.spend - a.spend ||
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
      spendFrom: from,
      spendTo: to,
      // Summed from the lines the report actually shows, so the totals on
      // screen are the totals of what is on screen. Both blends fold the same
      // array; each stays a pure function over one basis rather than one
      // function that has to be read twice to see which figure it is on.
      blended: { ...blendPerformance(campaigns), ...blendMargin(campaigns) },
      unattributed: tally.unattributed,
      totals: tally.totals,
    };
  }

  /**
   * The same period, reduced to the handful of figures that fit on a card.
   *
   * **It runs the report and reads fields off it.** That is a deliberate cost:
   * a summary that queried Spend and revenue itself would be a second
   * implementation of the same question, free to drift from the first, and the
   * failure would be a dashboard quietly contradicting the report one click
   * away — which is worse than either number being wrong on its own, because a
   * merchant cannot tell which to believe. The period helper, the matcher, the
   * Lookback Window and the Spend day range are therefore not reused *like* the
   * report's; they are the report's.
   *
   * The only figure computed here is the Unattributed share, which is a share
   * of two numbers the report already returns.
   */
  async summary(
    orgId: string,
    storeId: string,
    period: AttributionPeriod,
    touch: AttributionTouch,
  ): Promise<MarketingSummary> {
    const [report, spendEverRecorded] = await Promise.all([
      this.byCampaign(orgId, storeId, period, touch),
      this.spend.hasAny(orgId, storeId),
    ]);

    return {
      period: report.period,
      touch: report.touch,
      lookbackDays: report.lookbackDays,
      rangeStart: report.rangeStart,
      rangeEnd: report.rangeEnd,
      spendFrom: report.spendFrom,
      spendTo: report.spendTo,
      spend: report.blended.spend,
      revenue: report.blended.revenue,
      roas: report.blended.roas,
      realizedRevenue: report.totals.revenue,
      unattributedRevenue: report.unattributed.revenue,
      unattributedPct: pct(report.unattributed.revenue, report.totals.revenue),
      spendEverRecorded,
    };
  }
}
