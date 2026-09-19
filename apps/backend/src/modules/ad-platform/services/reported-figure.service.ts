import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AdPlatform } from '../../../shared/database/schema';
import { StoreService } from '../../tenant/services/store.service';
import {
  dayInTimezone,
  isCalendarDay,
} from '../../marketing/utils/spend-day.util';
import { countDays } from '../../marketing/utils/spend-range.util';
import { daysBefore } from '../utils/sync-window.util';
import { AdReportedFigureRepository } from '../repositories/ad-reported-figure.repository';

/**
 * One platform ad's figures for one day, as the merchant reads them.
 *
 * Built field by field rather than spread from the row, like every other view
 * in this module, and labelled with the platform that stated it — a Reported
 * Figure must never be mistakable for one of ours (ADR-0005).
 *
 * `adId` and `adName` are the claim made visible. A figure is held under the
 * platform's own ad id and stays there for ever; what a claim changes is
 * whether an Ad in this Store carries that id, which is resolved on the read.
 * Both are null for an ad nobody has claimed — including one the merchant
 * dismissed, whose money stays on the page because declining to attribute it
 * is not declining to know about it.
 */
export interface ReportedFigureView {
  /** The source. Every figure here was stated by this platform, not by us. */
  platform: AdPlatform;
  /** The ad's id at the platform — the key a claim will later match on. */
  externalAdId: string;
  /** `YYYY-MM-DD` in the store's timezone. */
  day: string;
  /** Minor units of `currency`, which is the ad account's, not the store's. */
  spend: number;
  impressions: number;
  clicks: number;
  /** On the platform's own attribution window, which is not our Lookback Window. */
  conversions: number;
  /** What the platform claims the ad earned. Never an input to any margin. */
  reportedRevenue: number;
  /** The platform's own ROAS in basis points, or null where it stated none. */
  reportedRoasBp: number | null;
  /** The ad account's currency. Stored as what it is; never converted. */
  currency: string;
  /**
   * The window the platform counted the conversions and revenue above on,
   * as it stated it. Null where it stated none — not a zero, and never ours.
   *
   * It travels with the figure rather than being looked up, because it is the
   * explanation for the gap between this row and the merchant's own: a factor
   * of two between the two books is a measurement difference, and without the
   * two windows in front of them a merchant reads it as a tracking failure.
   */
  attributionClickDays: number | null;
  attributionViewDays: number | null;
  /** When a sync last confirmed this figure. */
  syncedAt: Date;
  /** The Ad claiming this platform ad, or null while nothing does. */
  adId: string | null;
  adName: string | null;
  /** The Campaign that Ad hangs from, for a link straight to its card. */
  campaignId: string | null;
}

/** The window a read covers when the merchant did not name one. */
const DEFAULT_RANGE_DAYS = 30;

/** The longest window one read may cover, matching Spend's own cap. */
const MAX_RANGE_DAYS = 366;

/**
 * Reading back what the ad platform said.
 *
 * A read path, and therefore one that never reaches the ad platform. Everything
 * it returns was pulled by a sync and written to our own database, which is why
 * a vendor outage costs a merchant freshness rather than a page: figures stay
 * readable through a failed sync, and the failure is shown beside them from the
 * connection's own record rather than discovered by trying the vendor again
 * here.
 */
@Injectable()
export class ReportedFigureService {
  constructor(
    private readonly figures: AdReportedFigureRepository,
    private readonly stores: StoreService,
  ) {}

  async list(
    orgId: string,
    storeId: string,
    query: { from?: string; to?: string; platform?: AdPlatform },
  ): Promise<ReportedFigureView[]> {
    const store = await this.stores.findById(storeId, orgId);
    if (!store) throw new NotFoundException('Store not found');

    // The store's today, not the server's: the day a merchant is looking at is
    // the day their ad platform is reporting, and the same day their Spend is
    // recorded against.
    const today = dayInTimezone(new Date(), store.timezone);
    const to = query.to ?? today;
    const from = query.from ?? daysBefore(to, DEFAULT_RANGE_DAYS - 1);

    for (const [label, day] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (!isCalendarDay(day)) {
        throw new BadRequestException(
          `${label} must be a calendar date written as YYYY-MM-DD`,
        );
      }
    }

    const span = countDays(from, to);
    if (span === 0) {
      throw new BadRequestException('from must be on or before to');
    }
    if (span > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `A range may cover at most ${MAX_RANGE_DAYS} days`,
      );
    }

    const rows = await this.figures.findForStore(
      orgId,
      storeId,
      from,
      to,
      query.platform,
    );

    return rows.map(({ figure, adId, adName, campaignId }) => ({
      platform: figure.platform,
      externalAdId: figure.externalAdId,
      day: figure.day,
      spend: figure.spend,
      impressions: figure.impressions,
      clicks: figure.clicks,
      conversions: figure.conversions,
      reportedRevenue: figure.reportedRevenue,
      reportedRoasBp: figure.reportedRoasBp,
      currency: figure.currency,
      attributionClickDays: figure.attributionClickDays,
      attributionViewDays: figure.attributionViewDays,
      syncedAt: figure.syncedAt,
      adId,
      adName,
      campaignId,
    }));
  }
}
