import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';
import { resolveLookbackDays } from '../../../shared/attribution/lookback';
import { CampaignRepository } from '../repositories/campaign.repository';
import {
  AttributionRepository,
  type AttributionTouch,
} from '../repositories/attribution.repository';
import { createCampaignMatcher } from '../utils/campaign-matching.util';
import {
  tallyAttributedRevenue,
  type RevenueBucket,
} from '../utils/attributed-revenue.util';

export type { AttributionTouch };

/**
 * The same four windows the dashboard and analytics reports offer, resolved the
 * same way. Marketing owns its own copy rather than importing analytics' —
 * exactly as analytics owns its own rather than importing the dashboard's — so
 * a report module never depends on another report module.
 */
export type AttributionPeriod = 'today' | '7d' | '30d' | '90d';

export interface CampaignRevenueLine {
  campaignId: string;
  name: string;
  tag: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
  orders: number;
  /** In the smallest currency unit. Never formatted here. */
  revenue: number;
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
  /** Its own line. Never redistributed across the campaigns above. */
  unattributed: RevenueBucket;
  /** Attributed plus unattributed — the period's realized revenue. */
  totals: RevenueBucket;
}

function periodDays(period: AttributionPeriod): number {
  if (period === 'today') return 1;
  if (period === '7d') return 7;
  if (period === '30d') return 30;
  return 90;
}

/** `[start, now)`, matching the dashboard and analytics reports exactly. */
function getRange(period: AttributionPeriod): { start: Date; end: Date } {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start, end: now };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - periodDays(period));
  return { start, end: now };
}

const EMPTY: RevenueBucket = { orders: 0, revenue: 0 };

/**
 * Revenue and Order count per Campaign for a period — the question this whole
 * feature exists to answer.
 *
 * Nothing is precomputed. Every read loads the period's Orders and the Store's
 * matching rules and resolves one against the other, which is what makes a
 * Campaign created after its ads ran claim their Orders, and a corrected rule
 * repair the report rather than only changing what happens next. The cost is a
 * scan per read, traded deliberately for that correctness (ADR-0001); if it
 * ever matters, a resolved-campaign cache column is a rebuildable optimization.
 */
@Injectable()
export class AttributedRevenueService {
  private readonly lookbackDays: number;

  constructor(
    private readonly campaigns: CampaignRepository,
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
    const { start, end } = getRange(period);

    // Tenancy is enforced on all three reads. The matcher itself is pure and
    // will faithfully match whatever rules it is handed, so a Store's rules
    // never meeting another Store's orders is a property of this method.
    const [campaignRows, rules, orderRows] = await Promise.all([
      this.campaigns.findMany(orgId, storeId),
      this.campaigns.findMatchableRules(orgId, storeId),
      this.attribution.findAttributableOrders(
        orgId,
        storeId,
        touch,
        start,
        end,
      ),
    ]);

    const tally = tallyAttributedRevenue(
      orderRows,
      createCampaignMatcher(rules),
      this.lookbackDays,
    );

    // An archived campaign appears only if it earned something in the period —
    // it keeps explaining the orders it drove without cluttering the report
    // forever. An active one appears at zero, because "this push produced
    // nothing" is exactly what a merchant is reading the report to find out.
    const campaigns = campaignRows
      .map((campaign) => ({
        campaign,
        bucket: tally.byCampaign.get(campaign.id) ?? EMPTY,
      }))
      .filter(({ campaign, bucket }) => {
        return campaign.status === 'active' || bucket.orders > 0;
      })
      .map(({ campaign, bucket }) => ({
        campaignId: campaign.id,
        name: campaign.name,
        tag: campaign.tag,
        platform: campaign.platform,
        status: campaign.status,
        orders: bucket.orders,
        revenue: bucket.revenue,
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
      unattributed: tally.unattributed,
      totals: tally.totals,
    };
  }
}
