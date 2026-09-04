import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';
import { resolveLookbackDays } from '../../../shared/attribution/lookback';
import { pct } from '../../../shared/utils/percent.util';
import { StoreService } from '../../tenant/services/store.service';
import { CampaignRepository } from '../repositories/campaign.repository';
import { CampaignSpendRepository } from '../repositories/campaign-spend.repository';
import {
  AttributionRepository,
  type AttributionTouch,
} from '../repositories/attribution.repository';
import { createCampaignMatcher } from '../utils/campaign-matching.util';
import {
  resolvePeriodRange,
  type AttributionPeriod,
} from '../utils/attribution-period.util';
import {
  tallyAttributedRevenue,
  type RevenueBucket,
} from '../utils/attributed-revenue.util';
import { spendDayRange } from '../utils/spend-day.util';
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

export interface CampaignRevenueLine extends MarginInput, CampaignMargin {
  campaignId: string;
  name: string;
  tag: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
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
   * Spend recorded against this Campaign for the period, in the smallest
   * currency unit. Zero for a Campaign nobody recorded a cost against.
   */
  spend: number;
  /**
   * Revenue over Spend, to two decimal places. A **ratio**, not money — 4.25
   * means $4.25 back per dollar spent — so the integer-cents rule does not
   * apply to it. Null when nothing was spent: see `roasFor`.
   */
  roas: number | null;
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
 */
@Injectable()
export class AttributedRevenueService {
  private readonly lookbackDays: number;

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly attribution: AttributionRepository,
    private readonly spend: CampaignSpendRepository,
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

    // Tenancy is enforced on all four reads. The matcher itself is pure and
    // will faithfully match whatever rules it is handed, so a Store's rules
    // never meeting another Store's orders is a property of this method.
    const [campaignRows, rules, orderRows, spendByCampaign] = await Promise.all(
      [
        this.campaigns.findMany(orgId, storeId),
        this.campaigns.findMatchableRules(orgId, storeId),
        this.attribution.findAttributableOrders(
          orgId,
          storeId,
          touch,
          start,
          end,
        ),
        this.spend.sumByCampaign(orgId, storeId, from, to),
      ],
    );

    const tally = tallyAttributedRevenue(
      orderRows,
      createCampaignMatcher(rules),
      this.lookbackDays,
    );

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
        spend: spendByCampaign.get(campaign.id) ?? 0,
      }))
      .filter(({ campaign, bucket, spend }) => {
        return campaign.status === 'active' || bucket.orders > 0 || spend > 0;
      })
      .map(({ campaign, bucket, goods, spend }) => ({
        campaignId: campaign.id,
        name: campaign.name,
        tag: campaign.tag,
        platform: campaign.platform,
        status: campaign.status,
        orders: bucket.orders,
        revenue: bucket.revenue,
        spend,
        roas: roasFor(bucket.revenue, spend),
        // Both bases travel to the caller. They are different numbers and the
        // page has to name which is which rather than leave a merchant to
        // notice that ROAS and margin do not reconcile.
        ...goods,
        ...marginFor({ ...goods, spend }),
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
