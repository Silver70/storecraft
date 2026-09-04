import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAttributionController } from './controllers/admin-attribution.controller';
import { AdminCampaignController } from './controllers/admin-campaign.controller';
import { AttributionRepository } from './repositories/attribution.repository';
import { CampaignRepository } from './repositories/campaign.repository';
import { AttributedRevenueService } from './services/attributed-revenue.service';
import { CampaignService } from './services/campaign.service';

/**
 * Marketing: Campaigns, the matching rules that resolve an Order's raw UTM tuple
 * onto one, and the attributed-revenue reads those two exist to produce. A
 * standalone feature module in the same shape as analytics, so it can grow
 * without pulling on commerce.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminCampaignController, AdminAttributionController],
  providers: [
    CampaignRepository,
    AttributionRepository,
    CampaignService,
    AttributedRevenueService,
  ],
  exports: [CampaignRepository, CampaignService, AttributedRevenueService],
})
export class MarketingModule {}
