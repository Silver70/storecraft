/**
 * What a candidate matching rule would do to a period's Orders, as a pure
 * function over rows already read.
 *
 * Campaigns resolve at read time (ADR-0001), so a saved rule changes historical
 * figures the moment it exists. That property is what lets a correction repair
 * the past; it is also what lets a careless rule quietly rewrite it. This is
 * the answer shown before saving, so the merchant can tell a precise rule from
 * one that swallows everything.
 *
 * The preview is computed by running the *real* matcher twice — once over the
 * Store's saved rules, once over those rules plus the candidate — and comparing
 * the two verdicts per Order. Nothing about matching is re-implemented here.
 * That is the whole reason the figures shown are the figures saving produces:
 * there is no second definition of a match to drift from the first.
 *
 * Three outcomes are worth telling apart, and all three are reported:
 *
 *  - **Claimed.** The candidate wins an Order its Campaign does not have today.
 *    Either it was Unattributed, or another Campaign had it and the candidate
 *    outranks that Campaign's rule — the second reshapes someone else's numbers
 *    and is never folded into the first.
 *  - **Blocked.** The candidate matches the Order's tuple but loses to a rule
 *    that outranks it. Nothing moves, and the merchant sees why their rule
 *    claims less than they expected.
 *  - **Untouched.** The candidate does not match at all.
 */
import {
  campaignCreditFor,
  type AttributableOrder,
  type RevenueBucket,
} from './attributed-revenue.util';
import {
  createCampaignMatcher,
  referrerHost,
  type MatchableRule,
} from './campaign-matching.util';
import type { CampaignRuleField } from '../../../shared/database/schema';

/** One Order, plus the identity a merchant needs to recognise it on screen. */
export interface PreviewableOrder extends AttributableOrder {
  id: string;
  orderNumber: string;
}

/** One Order the candidate rule would move, named so it can be recognised. */
export interface PreviewSample {
  orderId: string;
  orderNumber: string;
  placedAt: Date;
  /** In the smallest currency unit. Never formatted here. */
  total: number;
  /** The Campaign crediting it today. Null is Unattributed. */
  currentCampaignId: string | null;
  /**
   * What the Order actually carries in the field the rule compares — the thing
   * that makes an over-broad rule obvious at a glance.
   */
  matchedValue: string | null;
}

export interface RulePreviewInput {
  /**
   * The period's Orders. The counts are over all of them; `samples` takes the
   * first `sampleLimit` claimed Orders in the order given, so a caller that
   * wants the newest named should read them newest first.
   */
  orders: Iterable<PreviewableOrder>;
  /** Every rule already saved in the Store, across all of its Campaigns. */
  existingRules: readonly MatchableRule[];
  /** The candidate, carrying the Campaign id and creation time it would have. */
  candidate: MatchableRule;
  lookbackDays: number;
  sampleLimit: number;
}

export interface RulePreviewTally {
  /** Orders the rule would move onto its Campaign. The headline figure. */
  claimed: RevenueBucket;
  /** The part of `claimed` that is Unattributed today. */
  fromUnattributed: RevenueBucket;
  /** The rest of `claimed`, by the Campaign id that would lose it. */
  takenFrom: Map<string, RevenueBucket>;
  /**
   * Orders the candidate matches but does not win, by the Campaign id whose
   * rule outranks it. These are the overlaps that do not move — visible so the
   * merchant is not left wondering why a broad rule reports a small number.
   */
  blockedBy: Map<string, RevenueBucket>;
  /** The Campaign's figures as they stand, and as they would stand. */
  campaignBefore: RevenueBucket;
  campaignAfter: RevenueBucket;
  /** Every Order read — the scale the claim has to be judged against. */
  totals: RevenueBucket;
  samples: PreviewSample[];
}

function empty(): RevenueBucket {
  return { orders: 0, revenue: 0 };
}

function add(bucket: RevenueBucket, order: AttributableOrder): void {
  bucket.orders += 1;
  bucket.revenue += order.total;
}

function bump(
  buckets: Map<string, RevenueBucket>,
  key: string,
  order: AttributableOrder,
): void {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = empty();
    buckets.set(key, bucket);
  }
  add(bucket, order);
}

/** What the Order carries in the field a rule compares, as it would be read. */
function valueInField(
  order: PreviewableOrder,
  field: CampaignRuleField,
): string | null {
  if (field === 'utm_campaign') return order.touch.utmCampaign ?? null;
  if (field === 'utm_source') return order.touch.utmSource ?? null;
  if (field === 'utm_medium') return order.touch.utmMedium ?? null;
  return referrerHost(order.touch.referrer);
}

/**
 * Runs a candidate rule against a period's Orders without saving anything.
 *
 * Adding a rule can only ever *add* matches — the matcher returns the first
 * rule in precedence order, so a new rule changes an Order's verdict only by
 * winning it. An Order therefore ends up either where it already was or on the
 * candidate's Campaign, which is why `campaignAfter` can never be smaller than
 * `campaignBefore` and why a preview cannot show a Campaign losing revenue to
 * its own new rule.
 */
export function previewMatchingRule(input: RulePreviewInput): RulePreviewTally {
  const { candidate, lookbackDays, sampleLimit } = input;
  const claimant = candidate.campaignId;

  const before = createCampaignMatcher(input.existingRules);
  const after = createCampaignMatcher([...input.existingRules, candidate]);
  // A matcher holding nothing but the candidate, so "this rule does not match
  // the order" can be told apart from "it matches and loses". The second is an
  // overlap the merchant has to see; the first is nothing at all. Asking the
  // real matcher rather than comparing values by hand is deliberate — a second
  // implementation of matching here could disagree with the one that counts.
  const alone = createCampaignMatcher([candidate]);

  const tally: RulePreviewTally = {
    claimed: empty(),
    fromUnattributed: empty(),
    takenFrom: new Map(),
    blockedBy: new Map(),
    campaignBefore: empty(),
    campaignAfter: empty(),
    totals: empty(),
    samples: [],
  };

  for (const order of input.orders) {
    add(tally.totals, order);

    const currentId = campaignCreditFor(order, before, lookbackDays);
    const nextId = campaignCreditFor(order, after, lookbackDays);

    if (currentId === claimant) add(tally.campaignBefore, order);
    if (nextId === claimant) add(tally.campaignAfter, order);

    if (nextId === claimant && currentId !== claimant) {
      add(tally.claimed, order);
      if (currentId === null) add(tally.fromUnattributed, order);
      else bump(tally.takenFrom, currentId, order);

      if (tally.samples.length < sampleLimit) {
        tally.samples.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          placedAt: order.placedAt,
          total: order.total,
          currentCampaignId: currentId,
          matchedValue: valueInField(order, candidate.field),
        });
      }
      continue;
    }

    // Nothing moved. If the candidate would have claimed this Order on its own,
    // some other Campaign's rule outranks it — an overlap, and the reason the
    // headline figure is smaller than the rule's wording suggests.
    const wouldClaimAlone =
      campaignCreditFor(order, alone, lookbackDays) === claimant;
    if (wouldClaimAlone && currentId !== null && currentId !== claimant) {
      bump(tally.blockedBy, currentId, order);
    }
  }

  return tally;
}
