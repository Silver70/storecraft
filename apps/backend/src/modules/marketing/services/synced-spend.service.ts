import { Injectable, Logger } from '@nestjs/common';
import { StoreService } from '../../tenant/services/store.service';
import { AdRepository } from '../repositories/ad.repository';
import { CampaignSpendRepository } from '../repositories/campaign-spend.repository';
import type { SyncedSpendRow } from '../repositories/campaign-spend.repository';
import { isCalendarDay } from '../utils/spend-day.util';

/** What one platform ad spent on one day, as the platform reported it. */
export interface PlatformSpendDay {
  /** The ad's id at the platform. What an Ad claims to attach this to itself. */
  externalAdId: string;
  /** `YYYY-MM-DD` as the platform dated it. */
  day: string;
  /** In minor units of `currency`, converted at the edge and never a float. */
  amount: number;
}

export interface ApplySyncedSpendInput {
  organizationId: string;
  storeId: string;
  /** The ad account's currency, which is allowed not to be the Store's. */
  currency: string;
  days: readonly PlatformSpendDay[];
}

/**
 * What a sync's Spend write did, in the terms the merchant is shown.
 *
 * Every field is a count of days rather than of ads, because a day is the grain
 * the merchant reads and the grain that can be pinned.
 */
export interface SyncedSpendOutcome {
  /** Days written or corrected against a claimed Ad. */
  written: number;
  /**
   * Days left alone because the merchant pinned them.
   *
   * **Not a failure, and reported as its own number rather than folded into
   * one.** A sync that treated a pinned day as an error would either retry it
   * forever or mark an otherwise healthy connection as failing, and the
   * merchant would be shown a problem where there is a decision.
   */
  declinedPinned: number;
  /**
   * Days the platform reported for ads nothing in this Store claims.
   *
   * They are not lost: the money is in `ad_reported_figures` and the ad is held
   * as an Unlinked Ad waiting to be claimed. Claiming it brings these days into
   * the merchant's book on the next sync.
   */
  unclaimed: number;
  /**
   * The mismatch that stopped a write, or null.
   *
   * Present means nothing was written at all: an ad account reporting in EUR
   * cannot have its figures dropped into a USD Store's book, because
   * `campaign_spend` is summed without regard to currency and there is no
   * conversion anywhere in this feature (ADR-0005). The merchant is shown the
   * mismatch instead of a total built on an invented rate.
   */
  currencyMismatch: { store: string; account: string } | null;
}

/**
 * The one path by which an ad platform's figures reach the merchant's own book
 * of Spend.
 *
 * ## Why this is allowed at all, when a Reported Figure is not
 *
 * ADR-0005 keeps the platform's *revenue*, conversions and ROAS beside ours and
 * never merged into them, because those are claims made on an attribution
 * window that is not ours and a revenue total that changed depending on what
 * synced that day would be incomparable with itself. Spend is the other side of
 * that boundary: what an ad account was charged is the same fact the merchant
 * would otherwise read off the platform's dashboard and type in by hand, and
 * making them keep typing it is the entire problem this stage exists to solve.
 *
 * So the figure is written into `campaign_spend` — and the row says it was
 * synced, so nothing has to guess later. **Nothing else from the platform is
 * written here.** No revenue, no conversions, no ROAS: they stay in
 * `ad_reported_figures`, and Contribution Margin still never sees them.
 *
 * ## What this refuses to do
 *
 * It writes against an Ad and never against a Campaign as a whole. A
 * Campaign-level row means the cost is known and its split is not, which is a
 * statement only a merchant is in a position to make — a sync always knows
 * which creative spent the money, or it has no business writing at all.
 *
 * It writes nothing for an ad no Ad claims. The money is already recorded in
 * the platform's book and the ad is already held as an Unlinked Ad; inventing
 * an Ad to hang the cost on is the one thing this whole stage refuses to do.
 *
 * It writes nothing at all across a currency mismatch, for the reason the hand
 * path refuses one: `campaign_spend` is summed as a single currency, and a EUR
 * figure landing in a USD Store's totals would silently distort every ratio
 * built on it.
 *
 * And it never overwrites a pinned day. That is enforced in the SQL rather than
 * here — see `CampaignSpendRepository.recordSynced` — so a day pinned between
 * this service's read and its write is still protected.
 */
@Injectable()
export class SyncedSpendService {
  private readonly logger = new Logger(SyncedSpendService.name);

  constructor(
    private readonly ads: AdRepository,
    private readonly spend: CampaignSpendRepository,
    private readonly stores: StoreService,
  ) {}

  /**
   * Drops the Spend a sync wrote against one Ad.
   *
   * Called when a claim is undone. A scheduled sync only re-reads a trailing
   * window, so nothing would ever come back and correct these rows to zero —
   * the Ad would keep reporting a cost it no longer claims, and a re-claim of
   * the same platform ad onto a different Ad would write those days again under
   * a second name.
   *
   * What the merchant typed, and what they pinned, is left exactly where it is.
   */
  async detach(
    organizationId: string,
    storeId: string,
    adId: string,
  ): Promise<number> {
    const removed = await this.spend.removeSyncedForAd(
      adId,
      organizationId,
      storeId,
    );
    if (removed) {
      this.logger.log(
        `Detached ${removed} synced spend day(s) from ad ${adId} in store ${storeId}.`,
      );
    }
    return removed;
  }

  /**
   * Records what the platform said each claimed Ad spent, one row per Ad per
   * day.
   *
   * Returns what happened instead of throwing it, for the reason every step of
   * a sync does: this runs behind a scheduled job, and none of these outcomes —
   * a pinned day, an unclaimed ad, a foreign ad account — is an error. They are
   * all states a merchant should be able to read on the page.
   */
  async apply(
    input: ApplySyncedSpendInput,
    syncedAt: Date = new Date(),
  ): Promise<SyncedSpendOutcome> {
    const empty: SyncedSpendOutcome = {
      written: 0,
      declinedPinned: 0,
      unclaimed: 0,
      currencyMismatch: null,
    };
    if (input.days.length === 0) return empty;

    const store = await this.stores.findById(
      input.storeId,
      input.organizationId,
    );
    // A Store that vanished mid-sync writes nothing and says nothing went
    // wrong: the connection that named it is about to cascade away with it.
    if (!store) return empty;

    // Checked before the Ads are loaded, because a mismatch writes nothing at
    // all and there is no point resolving what could not be written.
    if (!sameCurrency(store.currency, input.currency)) {
      this.logger.warn(
        `Not recording synced spend for store ${input.storeId}: the ad account reports ${input.currency} and the store is ${store.currency}. There is no conversion.`,
      );
      return {
        ...empty,
        currencyMismatch: { store: store.currency, account: input.currency },
      };
    }

    const claimed = await this.ads.claimedByExternalId(
      input.organizationId,
      input.storeId,
    );

    const rows: SyncedSpendRow[] = [];
    let unclaimed = 0;
    for (const reported of input.days) {
      const ad = claimed.get(reported.externalAdId);
      if (!ad) {
        unclaimed += 1;
        continue;
      }

      // A day that is not a calendar day, or an amount that is not money, is
      // dropped rather than written. The adapter converts at the edge and the
      // window is already resolved in the Store's timezone, so neither should
      // happen — and a figure that slipped through would sit in the merchant's
      // own book of record looking exactly like one they typed.
      if (!isCalendarDay(reported.day)) continue;
      if (!Number.isSafeInteger(reported.amount) || reported.amount < 0)
        continue;

      rows.push({
        organizationId: input.organizationId,
        storeId: input.storeId,
        campaignId: ad.campaignId,
        adId: ad.adId,
        day: reported.day,
        amount: reported.amount,
        // The Store's own casing, as the hand path uses: the row records what
        // this Store's money was, not how the platform spelled it.
        currency: store.currency,
      });
    }

    const { written, declined } = await this.spend.recordSynced(rows, syncedAt);

    if (declined) {
      this.logger.log(
        `Left ${declined} pinned spend day(s) alone for store ${input.storeId} — the merchant's figure stands.`,
      );
    }

    return {
      written,
      declinedPinned: declined,
      unclaimed,
      currencyMismatch: null,
    };
  }
}

/** Case-insensitively, the way the hand path compares one. */
function sameCurrency(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}
