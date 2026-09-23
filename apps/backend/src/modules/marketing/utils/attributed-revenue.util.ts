/**
 * Which Campaign an Order's money is credited to, and what the credit adds up
 * to — as pure functions over rows already read.
 *
 * Attribution is resolved at read time (ADR-0001): the Order stores the raw
 * Touch, and the Campaign is an interpretation of it produced here on every
 * read. That is what lets a Campaign created after its ads ran claim the Orders
 * they drove, and a corrected matching rule repair a report rather than only
 * affecting Orders that have not happened yet.
 *
 * Three things can disqualify a Touch from claiming an Order, and all three
 * land it in Unattributed rather than on a Campaign:
 *
 *  - **No Touch at all.** The visitor arrived direct, or the storefront
 *    declared nothing.
 *  - **A Touch older than the Lookback Window.** A visit six months ago did not
 *    drive today's sale.
 *  - **A bot.** The event log classified the visitor as one, matching the
 *    exclusion every other event query already applies.
 *
 * A disqualified Order still counts in the totals. Its revenue is real, it just
 * has no Campaign to credit — and the report has to reconcile with the sales
 * reports for the same period, which count it too.
 */
import type {
  AttributionTuple,
  CampaignMatcher,
} from './campaign-matching.util';
import type { AdMatcher } from './ad-matching.util';
import { lookbackMs } from '../../../shared/attribution/lookback';

/** One Order, reduced to what deciding its Campaign credit actually needs. */
export interface AttributableOrder {
  /** Order total in the smallest currency unit. Never a float. */
  total: number;
  /** When the Order was placed — the anchor the Lookback Window measures from. */
  placedAt: Date;
  /**
   * The selected Touch (First or Last) as the Order froze it, and when it
   * happened. A null `at` means the Order carries no Touch of that kind.
   */
  touch: AttributionTuple & { at: Date | null };
  /** Whether the event log classified this Order's visitor as a bot. */
  isBot: boolean;
}

/** Money and Order count, the two figures every line of the report carries. */
export interface RevenueBucket {
  orders: number;
  revenue: number;
}

/**
 * How one Campaign's credit divides across its own Ads.
 *
 * Filled in the same pass from the same Order and the same matching decision as
 * the Campaign level above it — so an Ad created today claims the Orders its
 * links already produced, exactly as a Campaign created after its ads ran does.
 *
 * `unassigned` holds the Campaign's Orders that matched none of its Ads. It is
 * **not** Unattributed: those Orders have a Campaign, and it is the one this
 * tally belongs to. The two are different outcomes and are never folded
 * together — every Ad's figures plus this one add back up to the Campaign's own
 * line.
 */
export interface AdTally {
  /** Credit per Ad id. An Ad that earned none is simply absent. */
  byAd: Map<string, RevenueBucket>;
  /**
   * Everything this Campaign earned that no Ad of its claimed. Always its own
   * bucket — never spread across the Ads that happen to exist, which would make
   * every one of them look better than it is.
   */
  unassigned: RevenueBucket;
}

export interface AttributionTally {
  /** Credit per Campaign id. A Campaign that earned none is simply absent. */
  byCampaign: Map<string, RevenueBucket>;
  /**
   * The same credit again, divided by Ad within each Campaign that earned any
   * — the second pass of ADR-0004.
   *
   * Keyed by Campaign id, so a Campaign that earned nothing is absent here just
   * as it is from `byCampaign`. Two Campaigns each owning an Ad tagged
   * `video-a` therefore never meet: they are different entries holding
   * different Ad ids.
   */
  adsByCampaign: Map<string, AdTally>;
  /**
   * Everything that qualified for no Campaign. Always its own bucket — never
   * spread across Campaigns, which would make every one of them look better
   * than it is.
   */
  unattributed: RevenueBucket;
  /** Every Order read, credited or not. Reconciles with the sales reports. */
  totals: RevenueBucket;
}

/**
 * The Campaign that may claim this Order, or null for Unattributed.
 *
 * The window is inclusive and measured against the Order, not the clock: a
 * Touch is disqualified for being older than `lookbackDays` *before the
 * purchase*, so re-reading a report next month does not quietly move last
 * month's revenue into Unattributed.
 */
export function campaignCreditFor(
  order: AttributableOrder,
  matcher: CampaignMatcher,
  lookbackDays: number,
): string | null {
  if (order.isBot) return null;

  const touchedAt = order.touch.at;
  if (touchedAt === null) return null;

  // A Touch recorded after the order it belongs to is clock skew, not a stale
  // visit, so only the older side of the window disqualifies.
  const age = order.placedAt.getTime() - touchedAt.getTime();
  if (age > lookbackMs(lookbackDays)) return null;

  return matcher(order.touch)?.campaignId ?? null;
}

function add(bucket: RevenueBucket, order: AttributableOrder): void {
  bucket.orders += 1;
  bucket.revenue += order.total;
}

/** The bucket under `key`, created empty on first use. */
function bucketFor(
  map: Map<string, RevenueBucket>,
  key: string,
): RevenueBucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { orders: 0, revenue: 0 };
    map.set(key, bucket);
  }
  return bucket;
}

function emptyAdTally(): AdTally {
  return { byAd: new Map(), unassigned: { orders: 0, revenue: 0 } };
}

/**
 * Runs the credit decision over a period's Orders and sums the result, at both
 * grains.
 *
 * **One pass, two passes.** The loop is single — every figure the report shows
 * comes from the same read of the same rows, so a Campaign and its Ads can
 * never describe different periods or disagree about an Order. Within it the
 * *resolution* is two-pass per ADR-0004: `matcher` picks the Campaign from the
 * Touch, and only then does `adMatcher` pick an Ad, and only from that
 * Campaign's own. An Order that no Campaign claims is never offered to an Ad at
 * all.
 */
export function tallyAttributedRevenue(
  orders: Iterable<AttributableOrder>,
  matcher: CampaignMatcher,
  adMatcher: AdMatcher,
  lookbackDays: number,
): AttributionTally {
  const byCampaign = new Map<string, RevenueBucket>();
  const adsByCampaign = new Map<string, AdTally>();
  const unattributed: RevenueBucket = { orders: 0, revenue: 0 };
  const totals: RevenueBucket = { orders: 0, revenue: 0 };

  for (const order of orders) {
    add(totals, order);

    const campaignId = campaignCreditFor(order, matcher, lookbackDays);
    if (campaignId === null) {
      add(unattributed, order);
      continue;
    }

    add(bucketFor(byCampaign, campaignId), order);

    let ads = adsByCampaign.get(campaignId);
    if (!ads) {
      ads = emptyAdTally();
      adsByCampaign.set(campaignId, ads);
    }

    // The second pass, over this Campaign's Ads alone. Null is Unassigned —
    // the Order is the Campaign's and no creative of its claimed it — which is
    // its own bucket and never divided among the Ads that do exist.
    const adId = adMatcher(campaignId, order.touch);
    if (adId === null) {
      add(ads.unassigned, order);
      continue;
    }

    add(bucketFor(ads.byAd, adId), order);
  }

  return { byCampaign, adsByCampaign, unattributed, totals };
}
