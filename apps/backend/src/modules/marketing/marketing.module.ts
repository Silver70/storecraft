import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { R2StorageService } from '../../shared/storage/r2-storage.service';
import { TenantModule } from '../tenant/tenant.module';
import { AdminAdController } from './controllers/admin-ad.controller';
import { AdminAdSpendController } from './controllers/admin-ad-spend.controller';
import { AdminAttributionController } from './controllers/admin-attribution.controller';
import { AdminCampaignController } from './controllers/admin-campaign.controller';
import { AdminCampaignSpendController } from './controllers/admin-campaign-spend.controller';
import { AdRepository } from './repositories/ad.repository';
import { AttributionRepository } from './repositories/attribution.repository';
import { CampaignRepository } from './repositories/campaign.repository';
import { CampaignSpendRepository } from './repositories/campaign-spend.repository';
import { TrafficRepository } from './repositories/traffic.repository';
import { AdService } from './services/ad.service';
import { AttributedRevenueService } from './services/attributed-revenue.service';
import { CampaignService } from './services/campaign.service';
import { CampaignSpendService } from './services/campaign-spend.service';
import { RulePreviewService } from './services/rule-preview.service';

/**
 * Marketing: Campaigns, the Ads running under them, the matching rules that
 * resolve an Order's raw UTM tuple onto one, the Spend recorded against them,
 * and the attributed-revenue reads those exist to produce. A standalone feature
 * module in the same shape as analytics, so it can grow without pulling on
 * commerce.
 *
 * `TenantModule` is imported for the Store's currency and timezone, which a
 * Spend row is validated against. It is a domain module, not a report module —
 * the rule that a report module never depends on another report module is
 * untouched.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [
    AdminCampaignController,
    AdminAdController,
    AdminCampaignSpendController,
    AdminAdSpendController,
    AdminAttributionController,
  ],
  providers: [
    R2StorageService,
    CampaignRepository,
    AdRepository,
    CampaignSpendRepository,
    AttributionRepository,
    TrafficRepository,
    CampaignService,
    AdService,
    CampaignSpendService,
    AttributedRevenueService,
    RulePreviewService,
  ],
  exports: [
    CampaignRepository,
    AdRepository,
    CampaignSpendRepository,
    CampaignService,
    AdService,
    CampaignSpendService,
    AttributedRevenueService,
    RulePreviewService,
  ],
})
export class MarketingModule {}
