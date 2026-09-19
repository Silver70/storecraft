import { Module } from '@nestjs/common';
import { AdReportedFigureRepository } from './repositories/ad-reported-figure.repository';

/**
 * The platform's book of record, as a leaf.
 *
 * `ad_reported_figures` has two readers pulling in opposite directions:
 * `AdPlatformModule` writes it from a sync and reads it back for the Unlinked
 * Ads list, and `MarketingModule` reads it to put the platform's figures beside
 * ours on the card. `AdPlatformModule` already imports `MarketingModule` — for
 * `AdService`, `SyncedSpendService` and `PlatformMirrorService` — so the
 * repository cannot live in it and be reachable from marketing without the two
 * modules importing each other.
 *
 * So the table gets its own module, depending on nothing but the database, and
 * both import it. That is a smaller thing to hold in mind than a `forwardRef`
 * pair, and it says the true fact about this table plainly: it belongs to
 * neither of them.
 *
 * **Marketing reads it and never writes it.** `upsertMany` exists on the
 * repository for the sync alone, and the only marketing caller —
 * `AttributedRevenueService` — is a read path that puts what it finds in its
 * own field on the line, beside our figures and never into them (ADR-0005).
 * There is no path from a report into this table, and adding one would be the
 * change that makes a revenue total incomparable with itself.
 */
@Module({
  providers: [AdReportedFigureRepository],
  exports: [AdReportedFigureRepository],
})
export class ReportedFiguresModule {}
