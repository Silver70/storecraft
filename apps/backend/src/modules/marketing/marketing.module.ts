import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { AdminAdController } from './controllers/admin-ad.controller';
import { AdminAttributionController } from './controllers/admin-attribution.controller';
import { AdminCampaignController } from './controllers/admin-campaign.controller';
import { AdDailyFigureRepository } from './repositories/ad-daily-figure.repository';
import { AdRepository } from './repositories/ad.repository';
import { AttributionRepository } from './repositories/attribution.repository';
import { CampaignRepository } from './repositories/campaign.repository';
import { AdService } from './services/ad.service';
import { AttributedRevenueService } from './services/attributed-revenue.service';
import { CampaignService } from './services/campaign.service';

/**
 * Marketing: Campaigns and the Ads running under them — each one the ad
 * platform's own, keyed by the platform's id — and the attributed-revenue read
 * they exist to produce. A standalone feature module in the same shape as
 * analytics, so it can grow without pulling on commerce.
 *
 * An Order finds its Campaign and Ad by the platform ids the Link Tags wrote
 * into the click, under one credit rule, the latest ad click, written once in
 * `attributed-revenue.util`. There are no matching rules and no tags of our
 * own.
 *
 * `TenantModule` is imported for the Store the report is read for — its
 * timezone decides which of the platform's days a period covers. It is a
 * domain module, not a report module.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [
    AdminCampaignController,
    AdminAdController,
    AdminAttributionController,
  ],
  providers: [
    CampaignRepository,
    AdRepository,
    AdDailyFigureRepository,
    AttributionRepository,
    CampaignService,
    AdService,
    AttributedRevenueService,
  ],
  exports: [
    CampaignRepository,
    AdRepository,
    AdDailyFigureRepository,
    CampaignService,
    AdService,
    AttributedRevenueService,
  ],
})
export class MarketingModule {}
