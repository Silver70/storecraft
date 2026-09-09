/**
 * How a raw attribution tuple resolves to an Ad, as pure functions.
 *
 * This is the second of two passes (ADR-0004). The Campaign matcher next door
 * runs first and unchanged; only once it has named a Campaign does this one
 * pick a creative, and only from that Campaign's own Ads. The two are never in
 * one contest.
 *
 * That separation is the whole reason this file exists rather than one more
 * entry in `FIELD_RANK`. Campaign matching is first-match-wins over a single
 * flat order, so an Ad rule ranked alongside Campaign rules could claim a tuple
 * whose `utm_campaign` names a different Campaign — moving revenue between
 * Campaigns with nothing thrown. Here the Campaign is a *parameter*, so an Ad
 * cannot reach a sale outside its parent even in principle: the rules of other
 * Campaigns are not scanned, not ranked, and not loaded.
 *
 * It also buys the thing merchants actually do. Ad Tags are unique within a
 * Campaign rather than within a Store, so every Campaign is free to call its
 * variants `video-a` and `still-b`, and two Campaigns each owning a `video-a`
 * resolve independently because they never share a candidate list.
 *
 * Everything else follows the Campaign matcher exactly, because the failure
 * mode is the same one — a mis-match does not throw, it makes a creative look
 * dead forever:
 *
 * **Normalization.** Both sides of every comparison are reduced to the same
 * canonical form, so `Video_A` and `video-a` are one Ad.
 *
 * **Determinism.** When several of a Campaign's rules could claim one tuple,
 * the winner is decided by a documented total order, so the same tuple always
 * reports against the same Ad on every re-read.
 */
import type {
  CampaignRuleField,
  CampaignRuleOperator,
} from '../../../shared/database/schema';
import {
  normalizeMatchValue,
  type AttributionTuple,
} from './campaign-matching.util';

/**
 * The rule fields Ad resolution reads. Nothing else.
 *
 * One field, and it is the inverse of `CAMPAIGN_MATCH_FIELDS`: an Ad is the
 * creative a visitor clicked, and `utm_content` is where a link says which. A
 * rule on any other field is dropped before matching begins, so an Ad rule can
 * never be decided by evidence that belongs to its Campaign.
 */
export const AD_MATCH_FIELDS = ['utm_content'] as const;

export type AdMatchField = (typeof AD_MATCH_FIELDS)[number];

function isAdMatchField(field: CampaignRuleField): field is AdMatchField {
  return (AD_MATCH_FIELDS as readonly string[]).includes(field);
}

/** An Ad's matching rule, reduced to what deciding a match actually needs. */
export interface MatchableAdRule {
  adId: string;
  /**
   * The Campaign the Ad hangs from. Not a hint — it is the key the candidate
   * list is built under, and the reason an Ad cannot claim a sibling
   * Campaign's sale.
   */
  campaignId: string;
  field: CampaignRuleField;
  operator: CampaignRuleOperator;
  value: string;
  /** The owning Ad's creation time — the documented tie-break. */
  adCreatedAt: Date;
}

/**
 * Resolves one tuple *within one Campaign*.
 *
 * Null is Unassigned: the Order belongs to the Campaign and to none of its
 * Ads. Its own outcome, never spread across the Ads that happen to exist, and
 * a different thing from Unattributed — that one has no Campaign at all.
 */
export type AdMatcher = (
  campaignId: string,
  tuple: AttributionTuple,
) => string | null;

/** An exact statement beats a prefix that merely happens to cover it. */
const OPERATOR_RANK: Record<CampaignRuleOperator, number> = {
  equals: 0,
  starts_with: 1,
};

/** A rule with its comparison value already normalized. */
interface PreparedAdRule {
  adId: string;
  operator: CampaignRuleOperator;
  value: string;
}

/**
 * Orders one Campaign's rules so the first that matches is the one that should
 * win: operator, then the older Ad, then — so that two Ads created in the same
 * millisecond still resolve the same way on every read — the ids and values
 * themselves.
 *
 * There is no field term. Every rule that reaches this point is on
 * `utm_content`, which is what makes a second matcher safe rather than a second
 * chance for the same tuple.
 */
function compareRules(a: MatchableAdRule, b: MatchableAdRule): number {
  return (
    OPERATOR_RANK[a.operator] - OPERATOR_RANK[b.operator] ||
    a.adCreatedAt.getTime() - b.adCreatedAt.getTime() ||
    a.adId.localeCompare(b.adId) ||
    a.value.localeCompare(b.value)
  );
}

/**
 * Builds a matcher over a set of Ad rules.
 *
 * The rules are grouped by Campaign, normalized and ordered once, so resolving
 * a period's worth of Orders is a scan of one Campaign's candidates per Order
 * rather than a re-sort per Order. A rule whose value normalizes to nothing is
 * dropped here: it could never match, and keeping it would only give it a
 * chance to shadow a rule that can.
 *
 * A rule on a field Ad resolution does not read is dropped here too, before
 * anything is grouped.
 *
 * The caller owns tenancy. Hand this only rules loaded for one Organization and
 * Store — it will faithfully match whatever it is given.
 */
export function createAdMatcher(rules: readonly MatchableAdRule[]): AdMatcher {
  const byCampaign = new Map<string, PreparedAdRule[]>();

  const adRules = rules
    .filter((rule) => isAdMatchField(rule.field))
    .sort(compareRules);

  for (const rule of adRules) {
    const value = normalizeMatchValue(rule.value);
    if (value === null) continue;

    let prepared = byCampaign.get(rule.campaignId);
    if (!prepared) {
      prepared = [];
      byCampaign.set(rule.campaignId, prepared);
    }
    prepared.push({ adId: rule.adId, operator: rule.operator, value });
  }

  return (campaignId, tuple) => {
    const prepared = byCampaign.get(campaignId);
    if (prepared === undefined) return null;

    // Absence of evidence is not a match, on the same principle the Campaign
    // matcher already applies: a `utm_content` that normalizes to nothing —
    // missing, blank, or pure punctuation — is Unassigned, not the first Ad
    // whose rule happens to be a prefix of everything.
    const candidate = normalizeMatchValue(tuple.utmContent);
    if (candidate === null) return null;

    for (const rule of prepared) {
      const matched =
        rule.operator === 'equals'
          ? candidate === rule.value
          : candidate.startsWith(rule.value);

      if (matched) return rule.adId;
    }

    // Unassigned within the Campaign. Its own outcome, never redistributed
    // across the Ads that exist, and never an error.
    return null;
  };
}
