/**
 * Which Campaign and Ad an Order's money is credited to, and what the credit
 * adds up to — as pure functions over rows already read.
 *
 * **`creditFor` is the credit rule, and the only place it is written.** Every
 * report that credits revenue to a Campaign or an Ad reads it from here; none
 * re-implements it.
 *
 * The rule is the **latest ad click**: the Order's Last Touch if it names a
 * Campaign, otherwise its First Touch if that does. An untagged visit after an
 * ad click — a search for the Store's name, a bookmark, a newsletter link —
 * does not cancel the ad's credit, just as it would not at the platform.
 *
 * A Touch names a Campaign when its `utm_campaign` is exactly the platform
 * campaign id of a Campaign in this Store. The platform writes that id into the
 * link at the moment of the click (`utm_campaign={{campaign.id}}`), so the join
 * is an equality: there is no normalization, no precedence and no matching rule,
 * and a rename can never break it.
 *
 * The Ad comes from the same Touch that named the Campaign, by its
 * `utm_content`, and only from among that Campaign's own Ads. An Order that
 * names the Campaign but none of its Ads is **Unassigned** — the Campaign's, on
 * its own line, never spread across the Ads that happen to exist.
 *
 * Three things disqualify a Touch or an Order, and a disqualified Order lands in
 * Unattributed rather than on a Campaign:
 *
 *  - **No Touch at all**, or a Touch naming no Campaign of this Store.
 *  - **A Touch older than the Lookback Window.** A visit six months ago did not
 *    drive today's sale.
 *  - **A bot.** The event log classified the visitor as one, matching the
 *    exclusion every other event query already applies.
 *
 * A disqualified Order still counts in the totals. Its revenue is real, it just
 * has no Campaign to credit — and the report has to reconcile with the sales
 * reports for the same period, which count it too.
 */
import { lookbackMs } from '../../../shared/attribution/lookback';

/** One Touch as the Order froze it, reduced to what the join reads. */
export interface OrderTouch {
  /** The platform campaign id the Link Tags wrote, or whatever else was there. */
  utmCampaign: string | null;
  /** The platform ad id the Link Tags wrote, or whatever else was there. */
  utmContent: string | null;
  /** When it happened. Null means the Order carries no Touch of this kind. */
  at: Date | null;
}

/** One Order, reduced to what deciding its credit actually needs. */
export interface AttributableOrder {
  /** Order total in the smallest currency unit. Never a float. */
  total: number;
  /** When the Order was placed — the anchor the Lookback Window measures from. */
  placedAt: Date;
  firstTouch: OrderTouch;
  lastTouch: OrderTouch;
  /** Whether the event log classified this Order's visitor as a bot. */
  isBot: boolean;
}

/**
 * One Store's Campaigns and Ads, keyed by the platform ids a Touch carries.
 *
 * Built from a single Store's rows, which is what keeps one merchant's traffic
 * off another merchant's Campaigns: `creditFor` will faithfully match whatever
 * index it is handed.
 */
export interface CreditIndex {
  /** Platform campaign id → Campaign id. */
  campaigns: ReadonlyMap<string, string>;
  /** Platform ad id → the Ad and the Campaign it runs under. */
  ads: ReadonlyMap<string, { adId: string; campaignId: string }>;
}

/** Where one Order's money goes. `adId` null is Unassigned. */
export interface Credit {
  campaignId: string;
  adId: string | null;
}

/** Money and Order count, the two figures every line of the report carries. */
export interface RevenueBucket {
  orders: number;
  revenue: number;
}

/**
 * How one Campaign's credit divides across its own Ads.
 *
 * `unassigned` holds the Campaign's Orders that named none of its Ads. It is
 * **not** Unattributed: those Orders have a Campaign, and it is the one this
 * tally belongs to. Every Ad's figures plus this one add back up to the
 * Campaign's own line.
 */
export interface AdTally {
  /** Credit per Ad id. An Ad that earned none is simply absent. */
  byAd: Map<string, RevenueBucket>;
  unassigned: RevenueBucket;
}

export interface AttributionTally {
  /** Credit per Campaign id. A Campaign that earned none is simply absent. */
  byCampaign: Map<string, RevenueBucket>;
  /** The same credit again, divided by Ad within each Campaign that earned any. */
  adsByCampaign: Map<string, AdTally>;
  /**
   * Everything credited to no Campaign. Always its own bucket — never spread
   * across Campaigns, which would make every one of them look better than it
   * is.
   */
  unattributed: RevenueBucket;
  /** Every Order read, credited or not. Reconciles with the sales reports. */
  totals: RevenueBucket;
}

/**
 * The Campaign this Touch names, if it may still claim the Order.
 *
 * The window is inclusive and measured against the Order, not the clock: a
 * Touch is disqualified for being older than `lookbackDays` *before the
 * purchase*, so re-reading a report next month does not quietly move last
 * month's revenue into Unattributed. A Touch recorded after the Order is clock
 * skew, not a stale visit, so only the older side of the window disqualifies.
 */
function campaignNamedBy(
  touch: OrderTouch,
  placedAt: Date,
  index: CreditIndex,
  lookbackDays: number,
): string | null {
  if (touch.at === null || touch.utmCampaign === null) return null;
  if (placedAt.getTime() - touch.at.getTime() > lookbackMs(lookbackDays)) {
    return null;
  }
  return index.campaigns.get(touch.utmCampaign) ?? null;
}

/**
 * The Campaign and Ad an Order is credited to, or null for Unattributed.
 *
 * The latest ad click: the Last Touch if it names a Campaign, otherwise the
 * First Touch if it does. The Ad is read from the same Touch, and only if it
 * runs under that Campaign — an Ad of a sibling Campaign can never claim the
 * sale, and an Ad nobody recognises leaves it Unassigned.
 */
export function creditFor(
  order: AttributableOrder,
  index: CreditIndex,
  lookbackDays: number,
): Credit | null {
  if (order.isBot) return null;

  for (const touch of [order.lastTouch, order.firstTouch]) {
    const campaignId = campaignNamedBy(
      touch,
      order.placedAt,
      index,
      lookbackDays,
    );
    if (campaignId === null) continue;

    const ad =
      touch.utmContent === null ? undefined : index.ads.get(touch.utmContent);
    return {
      campaignId,
      adId: ad && ad.campaignId === campaignId ? ad.adId : null,
    };
  }

  return null;
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

/**
 * Runs the credit rule over a period's Orders and sums the result, at both
 * grains, in one pass — so a Campaign and its Ads can never describe different
 * periods or disagree about an Order.
 */
export function tallyAttributedRevenue(
  orders: Iterable<AttributableOrder>,
  index: CreditIndex,
  lookbackDays: number,
): AttributionTally {
  const byCampaign = new Map<string, RevenueBucket>();
  const adsByCampaign = new Map<string, AdTally>();
  const unattributed: RevenueBucket = { orders: 0, revenue: 0 };
  const totals: RevenueBucket = { orders: 0, revenue: 0 };

  for (const order of orders) {
    add(totals, order);

    const credit = creditFor(order, index, lookbackDays);
    if (credit === null) {
      add(unattributed, order);
      continue;
    }

    add(bucketFor(byCampaign, credit.campaignId), order);

    let ads = adsByCampaign.get(credit.campaignId);
    if (!ads) {
      ads = { byAd: new Map(), unassigned: { orders: 0, revenue: 0 } };
      adsByCampaign.set(credit.campaignId, ads);
    }

    if (credit.adId === null) add(ads.unassigned, order);
    else add(bucketFor(ads.byAd, credit.adId), order);
  }

  return { byCampaign, adsByCampaign, unattributed, totals };
}
