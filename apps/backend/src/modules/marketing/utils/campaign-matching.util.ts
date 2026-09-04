/**
 * How a raw attribution tuple resolves to a Campaign, as pure functions.
 *
 * Nothing here touches a database, a framework, or the clock. That is
 * deliberate: matching is the one part of attribution that fails *silently* — a
 * mis-match does not throw, it makes a Campaign look unprofitable forever — so
 * the decision itself is exercised exhaustively as a unit rather than inferred
 * from the far end of a checkout.
 *
 * Two properties carry the feature:
 *
 * **Normalization.** Both sides of every comparison are reduced to the same
 * canonical form, so `summer_sale`, `Summer-Sale` and ` summer sale ` are one
 * Campaign without the merchant authoring three rules. Real marketing links go
 * out tagged inconsistently, and without this each variant would become its own
 * bucket and split the revenue between them.
 *
 * **Determinism.** When several rules could claim one tuple, the winner is
 * decided by a documented total order, so the same tuple always reports against
 * the same Campaign — today, tomorrow, and on a re-read of an order placed last
 * month.
 */
import type {
  CampaignRuleField,
  CampaignRuleOperator,
} from '../../../shared/database/schema';

/** The canonical separator every normalized value collapses onto. */
const SEPARATOR = '-';

/**
 * Reduces a value to the form both sides of a comparison are made of.
 *
 * Trimmed, accent-folded, lowercased, with every run of separators and
 * punctuation collapsed to a single hyphen — the same separator
 * `deriveCampaignTag` produces, so a Campaign's canonical tag is already in
 * normalized form.
 *
 * Letters outside Latin are kept as themselves rather than stripped: a Campaign
 * tagged in Japanese must match itself, not collapse to nothing alongside every
 * other such Campaign.
 *
 * Returns null when nothing matchable is left — an empty string, whitespace, or
 * pure punctuation. Null never matches anything, including another null: absence
 * of evidence is Unattributed, not a match.
 */
export function normalizeMatchValue(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, SEPARATOR)
    .replace(/^-+|-+$/g, '');

  return normalized === '' ? null : normalized;
}

/**
 * The host a referring URL came from, without `www.` — `instagram.com` for
 * every path on it, so one rule covers the whole referrer rather than one per
 * link that was shared.
 *
 * A bare host (`instagram.com`) is accepted as readily as a full URL, because
 * that is what a merchant types into a rule. Anything unparseable is null,
 * which matches nothing.
 */
export function referrerHost(
  referrer: string | null | undefined,
): string | null {
  if (typeof referrer !== 'string') return null;
  const trimmed = referrer.trim();
  if (trimmed === '') return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * The attribution evidence one Touch carries, as the matcher reads it. The
 * referrer is the full referring URL — the host is extracted here, so callers
 * pass the column exactly as stored.
 */
export interface AttributionTuple {
  utmCampaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  referrer?: string | null;
}

/** A matching rule, reduced to what deciding a match actually needs. */
export interface MatchableRule {
  campaignId: string;
  field: CampaignRuleField;
  operator: CampaignRuleOperator;
  value: string;
  /** The owning Campaign's creation time — the documented tie-break. */
  campaignCreatedAt: Date;
}

/** Which Campaign claimed a tuple, and which rule of its did the claiming. */
export interface CampaignMatch {
  campaignId: string;
  rule: MatchableRule;
}

/** Resolves one tuple. Null is Unattributed — its own outcome, never a Campaign. */
export type CampaignMatcher = (tuple: AttributionTuple) => CampaignMatch | null;

/**
 * A rule on the campaign tag is the merchant's most specific statement of
 * intent; source and medium are broader and rank together; a referrer host is
 * the weakest, since it describes where a link was posted rather than what was
 * being run.
 */
const FIELD_RANK: Record<CampaignRuleField, number> = {
  utm_campaign: 0,
  utm_source: 1,
  utm_medium: 1,
  referrer_host: 2,
};

/** An exact statement beats a prefix that merely happens to cover it. */
const OPERATOR_RANK: Record<CampaignRuleOperator, number> = {
  equals: 0,
  starts_with: 1,
};

/** A rule with its comparison value already normalized. */
interface PreparedRule {
  rule: MatchableRule;
  value: string;
}

/**
 * Orders rules so the first one that matches is the one that should win:
 * field, then operator, then the older Campaign, then — so that two Campaigns
 * created in the same millisecond still resolve the same way on every read —
 * the ids and values themselves.
 */
function compareRules(a: MatchableRule, b: MatchableRule): number {
  return (
    FIELD_RANK[a.field] - FIELD_RANK[b.field] ||
    OPERATOR_RANK[a.operator] - OPERATOR_RANK[b.operator] ||
    a.campaignCreatedAt.getTime() - b.campaignCreatedAt.getTime() ||
    a.campaignId.localeCompare(b.campaignId) ||
    a.value.localeCompare(b.value)
  );
}

function normalizeTuple(
  tuple: AttributionTuple,
): Record<CampaignRuleField, string | null> {
  return {
    utm_campaign: normalizeMatchValue(tuple.utmCampaign),
    utm_source: normalizeMatchValue(tuple.utmSource),
    utm_medium: normalizeMatchValue(tuple.utmMedium),
    referrer_host: normalizeMatchValue(referrerHost(tuple.referrer)),
  };
}

/**
 * Builds a matcher over a set of rules.
 *
 * The rules are normalized and ordered once, so resolving a period's worth of
 * orders is a scan per order rather than a re-sort per order. A rule whose value
 * normalizes to nothing is dropped here: it could never match, and keeping it
 * would only give it a chance to shadow a rule that can.
 *
 * The caller owns tenancy. Hand this only rules loaded for one Organization and
 * Store — it will faithfully match whatever it is given.
 */
export function createCampaignMatcher(
  rules: readonly MatchableRule[],
): CampaignMatcher {
  const prepared: PreparedRule[] = [];
  for (const rule of [...rules].sort(compareRules)) {
    const value = normalizeMatchValue(rule.value);
    if (value !== null) prepared.push({ rule, value });
  }

  return (tuple) => {
    const values = normalizeTuple(tuple);

    for (const { rule, value } of prepared) {
      const candidate = values[rule.field];
      if (candidate === null) continue;

      const matched =
        rule.operator === 'equals'
          ? candidate === value
          : candidate.startsWith(value);

      if (matched) return { campaignId: rule.campaignId, rule };
    }

    // Unattributed. Always its own outcome, never redistributed across
    // campaigns, and never an error — an empty rule set lands here too.
    return null;
  };
}
