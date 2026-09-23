import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { R2StorageService } from '../../shared/storage/r2-storage.service';
import { TenantModule } from '../tenant/tenant.module';
import { AdminAdController } from './controllers/admin-ad.controller';
import { AdminAttributionController } from './controllers/admin-attribution.controller';
import { AdminCampaignController } from './controllers/admin-campaign.controller';
import { AdRepository } from './repositories/ad.repository';
import { AttributionRepository } from './repositories/attribution.repository';
import { CampaignRepository } from './repositories/campaign.repository';
import { AdService } from './services/ad.service';
import { AttributedRevenueService } from './services/attributed-revenue.service';
import { CampaignService } from './services/campaign.service';
import { PlatformMirrorService } from './services/platform-mirror.service';

/**
 * Marketing: Campaigns, the Ads running under them, the matching rules that
 * resolve an Order's raw UTM tuple onto one, and the attributed-revenue read
 * those exist to produce. A standalone feature module in the same shape as
 * analytics, so it can grow without pulling on commerce.
 *
 * `TenantModule` is imported for the Store the report is read for. It is a
 * domain module, not a report module — the rule that a report module never
 * depends on another report module is untouched.
 *
 * **There is no cost side here.** Spend was typed in by hand, one day at a
 * time, and everything built on it — ROAS, Contribution Margin, the platform's
 * figures printed beside ours, the queue of unclaimed ads — went with it. What
 * a campaign cost comes back when the ad platform reports it rather than when a
 * merchant remembers to, and it will arrive as the platform's figure and not as
 * a table anybody maintains.
 *
 * `PlatformMirrorService` is exported for one caller, the ad-platform sync, and
 * is the only way a sync reaches the `ads` table. It lives here because this
 * module owns what an Ad's `status` means. What it writes is the platform's own
 * state and placement, beside that status and never over it.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [
    AdminCampaignController,
    AdminAdController,
    AdminAttributionController,
  ],
  providers: [
    R2StorageService,
    CampaignRepository,
    AdRepository,
    AttributionRepository,
    CampaignService,
    AdService,
    AttributedRevenueService,
    PlatformMirrorService,
  ],
  exports: [
    CampaignRepository,
    AdRepository,
    CampaignService,
    AdService,
    AttributedRevenueService,
    PlatformMirrorService,
  ],
})
export class MarketingModule {}
