import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCampaignController } from './controllers/admin-campaign.controller';
import { CampaignRepository } from './repositories/campaign.repository';
import { CampaignService } from './services/campaign.service';

/**
 * Marketing: Campaigns, the matching rules that resolve an Order's raw UTM tuple
 * onto one, and (later) attributed-revenue reads. A standalone feature module in
 * the same shape as analytics, so it can grow without pulling on commerce.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminCampaignController],
  providers: [CampaignRepository, CampaignService],
  exports: [CampaignRepository, CampaignService],
})
export class MarketingModule {}
