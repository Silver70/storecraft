import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CampaignRuleField,
  CampaignRuleOperator,
  CampaignStatus,
} from '../../../shared/database/schema';
import { resolveLookbackDays } from '../../../shared/attribution/lookback';
import { CampaignRepository } from '../repositories/campaign.repository';
import {
  AttributionRepository,
  type AttributionTouch,
} from '../repositories/attribution.repository';
import {
  CampaignService,
  matchesExistingRule,
  prepareRuleValue,
} from './campaign.service';
import type { RevenueBucket } from '../utils/attributed-revenue.util';
import {
  resolvePeriodRange,
  type AttributionPeriod,
} from '../utils/attribution-period.util';
import { previewMatchingRule } from '../utils/rule-preview.util';

/** How many Orders a preview names. The figures are over all of them. */
const SAMPLE_LIMIT = 10;

export interface PreviewCampaignRuleInput {
  field: CampaignRuleField;
  operator: CampaignRuleOperator;
  value: string;
  period: AttributionPeriod;
  touch: AttributionTouch;
}

/** Another Campaign this rule would meet, and which way the revenue moves. */
export interface RulePreviewOverlap {
  campaignId: string;
  name: string;
  tag: string;
  status: CampaignStatus;
  /** What this Campaign would lose, because the candidate outranks its rule. */
  taken: RevenueBucket;
  /** What the candidate matches but this Campaign keeps, because it outranks. */
  blocked: RevenueBucket;
}

/** One Order the rule would claim, named so the merchant can recognise it. */
export interface RulePreviewSampleOrder {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  /** In the smallest currency unit. Never formatted here. */
  total: number;
  /** The Campaign crediting it today. Null is Unattributed. */
  currentCampaignId: string | null;
  currentCampaignName: string | null;
  /** What the Order carries in the field this rule compares. */
  matchedValue: string | null;
}

export interface RulePreviewReport {
  campaignId: string;
  campaignName: string;
  /** The candidate exactly as it would be stored and compared. */
  rule: {
    field: CampaignRuleField;
    operator: CampaignRuleOperator;
    /** What would be written to the row — a pasted URL is already a host here. */
    value: string;
    /** What both sides of every comparison are actually reduced to. */
    normalizedValue: string;
  };
  /** True when this Campaign already has a rule meaning the same — saving 409s. */
  duplicate: boolean;
  period: AttributionPeriod;
  touch: AttributionTouch;
  lookbackDays: number;
  rangeStart: string;
  rangeEnd: string;
  /** Orders the rule would move onto this Campaign. The headline figure. */
  claimed: RevenueBucket;
  /** The part of `claimed` that is Unattributed today. */
  fromUnattributed: RevenueBucket;
  /** Every other Campaign the rule would meet, in either direction. */
  overlaps: RulePreviewOverlap[];
  /** This Campaign's figures as they stand, and as they would stand. */
  campaignBefore: RevenueBucket;
  campaignAfter: RevenueBucket;
  /** The period's realized revenue — the scale to judge the claim against. */
  totals: RevenueBucket;
  /** How many Orders `samples` can hold, so a caller can say "10 of 47". */
  sampleLimit: number;
  samples: RulePreviewSampleOrder[];
}

const EMPTY: RevenueBucket = { orders: 0, revenue: 0 };

/**
 * What a candidate matching rule would do, before it is saved.
 *
 * Campaigns resolve at read time (ADR-0001), so a rule takes effect on history
 * the instant it exists. That is the property that lets a correction repair the
 * past, and it is also what lets an over-broad rule rewrite it — by the time the
 * report looks wrong, the reports the merchant already trusted have changed
 * underneath them. This makes the consequence visible at the moment of
 * authoring instead.
 *
 * The preview runs the same matcher, over the same rows, resolved for the same
 * period as the report it predicts. Nothing here re-implements matching or
 * re-defines a period, which is what makes "saving this produces what you were
 * shown" true rather than merely intended.
 *
 * It is a read in the strictest sense: no rule is created, nothing is cached,
 * and no report changes. Running it twice gives the same answer, and running it
 * never is indistinguishable from running it a hundred times.
 */
@Injectable()
export class RulePreviewService {
  private readonly lookbackDays: number;

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly campaignService: CampaignService,
    private readonly attribution: AttributionRepository,
    config: ConfigService,
  ) {
    this.lookbackDays = resolveLookbackDays(
      config.get('ATTRIBUTION_LOOKBACK_DAYS'),
    );
  }

  async preview(
    orgId: string,
    storeId: string,
    campaignId: string,
    input: PreviewCampaignRuleInput,
  ): Promise<RulePreviewReport> {
    // Tenancy and existence in one step: a campaign id belonging to another
    // Organization or Store reads as "not found", never as someone else's row.
    const campaign = await this.campaignService.get(orgId, storeId, campaignId);

    // Prepared exactly as saving would prepare it, including the 400 for a
    // value that could never match. Previewing something other than what would
    // be stored would be worse than not previewing at all.
    const { value, normalized } = prepareRuleValue(input.field, input.value);

    const { start, end } = resolvePeriodRange(input.period);

    const [campaignRows, existingRules, ownRules, orderRows] =
      await Promise.all([
        this.campaigns.findMany(orgId, storeId),
        this.campaigns.findMatchableRules(orgId, storeId),
        this.campaigns.findRulesForCampaign(campaignId, orgId, storeId),
        this.attribution.findPreviewableOrders(
          orgId,
          storeId,
          input.touch,
          start,
          end,
        ),
      ]);

    const tally = previewMatchingRule({
      orders: orderRows,
      existingRules,
      candidate: {
        campaignId,
        field: input.field,
        operator: input.operator,
        value,
        // The Campaign's real creation time, because it is the documented
        // tie-break: a candidate previewed with the wrong one could win a tie
        // it would lose once saved.
        campaignCreatedAt: campaign.createdAt,
      },
      lookbackDays: this.lookbackDays,
      sampleLimit: SAMPLE_LIMIT,
    });

    const named = new Map(campaignRows.map((row) => [row.id, row]));

    // One row per other Campaign the rule meets, carrying both directions:
    // what it would take, and what it matches but loses. Two separate lists
    // would make the merchant cross-reference them to see the same overlap.
    const overlaps: RulePreviewOverlap[] = [
      ...new Set([...tally.takenFrom.keys(), ...tally.blockedBy.keys()]),
    ]
      .map((id) => {
        const other = named.get(id);
        return {
          campaignId: id,
          name: other?.name ?? 'Unknown campaign',
          tag: other?.tag ?? '',
          status: other?.status ?? 'archived',
          taken: tally.takenFrom.get(id) ?? EMPTY,
          blocked: tally.blockedBy.get(id) ?? EMPTY,
        };
      })
      .sort(
        (a, b) =>
          b.taken.revenue - a.taken.revenue ||
          b.blocked.revenue - a.blocked.revenue ||
          a.name.localeCompare(b.name),
      );

    return {
      campaignId,
      campaignName: campaign.name,
      rule: {
        field: input.field,
        operator: input.operator,
        value,
        normalizedValue: normalized,
      },
      duplicate: matchesExistingRule(
        ownRules,
        input.field,
        input.operator,
        normalized,
      ),
      period: input.period,
      touch: input.touch,
      lookbackDays: this.lookbackDays,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      claimed: tally.claimed,
      fromUnattributed: tally.fromUnattributed,
      overlaps,
      campaignBefore: tally.campaignBefore,
      campaignAfter: tally.campaignAfter,
      totals: tally.totals,
      sampleLimit: SAMPLE_LIMIT,
      samples: tally.samples.map((sample) => ({
        orderId: sample.orderId,
        orderNumber: sample.orderNumber,
        placedAt: sample.placedAt.toISOString(),
        total: sample.total,
        currentCampaignId: sample.currentCampaignId,
        currentCampaignName:
          sample.currentCampaignId === null
            ? null
            : (named.get(sample.currentCampaignId)?.name ?? null),
        matchedValue: sample.matchedValue,
      })),
    };
  }
}
