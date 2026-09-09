/**
 * How many people a Campaign and each of its Ads were seen by, and what share
 * of them bought — as pure functions over rows already read.
 *
 * These are the report's only **measured** figures, and everything about their
 * shape exists to keep that visible. Revenue, purchases, Spend, ROAS and
 * Contribution Margin are derived from Orders: money that changed hands, kept
 * forever, and unaffected by what a browser was willing to run. These two come
 * from `analytics_events`, which an ad blocker can suppress entirely, which an
 * integrator may never have wired up, and which the retention purge deletes on
 * a schedule. They are not the same class of fact and must never be presented
 * as though they were — which is why they leave this module as their own
 * object rather than as two more fields alongside the rest.
 *
 * Resolution is the same two passes the money goes through (ADR-0004), using
 * the same two matchers over the same rules: `utm_campaign` names the Campaign,
 * and only then does `utm_content` name an Ad from that Campaign's own. An Ad
 * can no more claim a sibling Campaign's *visitor* than it can claim its sale.
 *
 * Nothing here touches a database, a framework, or the clock.
 */
import type {
  AttributionTuple,
  CampaignMatcher,
} from './campaign-matching.util';
import type { AdMatcher } from './ad-matching.util';
import { pctOneDecimal } from '../../../shared/utils/percent.util';

/**
 * One `(Campaign Tag, Ad Tag, visitor)` triple from the event stream, already
 * distinct — the same visitor arriving on the same pair of tags a hundred times
 * is one row.
 */
export interface TaggedVisitor {
  utmCampaign: string | null;
  utmContent: string | null;
  /** The visitor identity as the read resolved it. Opaque here. */
  visitorKey: string;
}

/**
 * Distinct visitors per Campaign and per Ad.
 *
 * **These do not add up, and that is not a defect.** A visitor who clicked two
 * of a Campaign's creatives is one visitor of that Campaign and a visitor of
 * both Ads, so the Ads sum to more than the Campaign. Revenue subdivides
 * because an Order belongs to exactly one Ad; an audience overlaps because a
 * person does not. It is the reason there is no Unassigned visitor figure —
 * a residue implies a subtraction, and there is none to do here.
 */
export interface VisitorTally {
  byCampaign: ReadonlyMap<string, number>;
  byAd: ReadonlyMap<string, number>;
}

/**
 * The measured pair, as one object.
 *
 * Kept together and kept apart from the order-derived figures on purpose. The
 * conversion rate's denominator *is* the visitor count beside it, so the two
 * share a reliability class exactly; presenting either one next to Revenue in
 * the same typography would claim a solidity neither has. When ad blockers eat
 * a third of the traffic, this denominator is a third too small and the rate
 * above it reads far higher than the truth — a merchant optimising toward that
 * number is optimising toward a fiction.
 */
export interface MeasuredTraffic {
  /**
   * Distinct visitors the event stream saw on this line's tags in the period.
   * Never zero: a line the stream has nothing for reports no measured figures
   * at all rather than a zero, because "we did not see anyone" and "nobody
   * came" are different claims and only one of them is ours to make.
   */
  visitors: number;
  /**
   * Purchases over visitors, as a percentage to one decimal.
   *
   * **The numerator and the denominator come from different sources**, which is
   * what makes this the most fragile figure on the report: the purchases are
   * the Orders the line actually earned, counted in full, while the visitors
   * are only those the tracker saw. Blocked traffic shrinks the denominator
   * alone and inflates the result.
   *
   * It is also a period ratio and not a cohort one — this period's purchases
   * over this period's visitors, not the fate of the visitors themselves. One
   * period governs the whole page, so a purchase whose click landed the day
   * before the window opened counts here without its visitor.
   */
  conversionRatePct: number;
}

/**
 * Resolves the event stream onto Campaigns and Ads and counts the distinct
 * people behind each.
 *
 * Sets rather than counters because the rows arrive per tag pair: one visitor
 * on `summer-sale` + `video-a` and again on `Summer_Sale` + `still-b` is two
 * rows, one Campaign visitor and two Ad visitors, and only a set of identities
 * gets that right at both grains.
 *
 * A row whose `utm_campaign` resolves to no Campaign is dropped. It is the
 * event-stream twin of Unattributed, and there is no line on this report for it
 * to belong to.
 *
 * The caller owns tenancy, exactly as both matchers' callers do: hand this only
 * rows read for one Organization and Store.
 */
export function tallyVisitors(
  rows: Iterable<TaggedVisitor>,
  matcher: CampaignMatcher,
  adMatcher: AdMatcher,
): VisitorTally {
  const campaignVisitors = new Map<string, Set<string>>();
  const adVisitors = new Map<string, Set<string>>();

  for (const row of rows) {
    const tuple: AttributionTuple = {
      utmCampaign: row.utmCampaign,
      utmContent: row.utmContent,
    };

    const match = matcher(tuple);
    if (match === null) continue;

    seen(campaignVisitors, match.campaignId).add(row.visitorKey);

    // The second pass, over that Campaign's Ads alone. Null is an untagged
    // link or a tag no Ad of this Campaign owns — the visitor is the
    // Campaign's and no creative's, and is not redistributed across the
    // creatives that exist.
    const adId = adMatcher(match.campaignId, tuple);
    if (adId === null) continue;

    seen(adVisitors, adId).add(row.visitorKey);
  }

  return {
    byCampaign: collapse(campaignVisitors),
    byAd: collapse(adVisitors),
  };
}

function seen(index: Map<string, Set<string>>, key: string): Set<string> {
  let visitors = index.get(key);
  if (!visitors) {
    visitors = new Set();
    index.set(key, visitors);
  }
  return visitors;
}

function collapse(index: Map<string, Set<string>>): Map<string, number> {
  return new Map(
    [...index].map(([key, visitors]) => [key, visitors.size] as const),
  );
}

/**
 * The measured pair for one line, or nothing.
 *
 * **Absent, not zero.** A Campaign or Ad the event stream holds nothing for
 * gets no measured figures at all. A zero would say nobody came; the truth is
 * that we did not see anyone, and on a Store with no tracker embedded — or a
 * period the retention purge has already reached — that is every line on the
 * page. Reporting it as zero would make every creative look like it was never
 * clicked and every conversion rate look like a total failure.
 */
export function measuredTrafficFor(
  visitors: number | undefined,
  purchases: number,
): MeasuredTraffic | null {
  if (visitors === undefined || visitors === 0) return null;
  return {
    visitors,
    conversionRatePct: pctOneDecimal(purchases, visitors),
  };
}
