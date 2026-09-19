import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { R2StorageService } from '../../shared/storage/r2-storage.service';
import { TenantModule } from '../tenant/tenant.module';
import { ReportedFiguresModule } from '../ad-platform/reported-figures.module';
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
import { PlatformMirrorService } from './services/platform-mirror.service';
import { SyncedSpendService } from './services/synced-spend.service';

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
 *
 * `SyncedSpendService` is exported for one caller, the ad-platform sync, and is
 * the only way a figure pulled from a platform reaches `campaign_spend`. It
 * lives here rather than there because this module owns what Spend is and what
 * may be written to it — including the rule that a pinned day is the merchant's
 * and a sync may not have it.
 *
 * `ReportedFiguresModule` is imported so the performance report can put the ad
 * platform's own figures beside ours on each Ad's line. **A read and only a
 * read.** The figures arrive in their own field, labelled with the platform
 * that stated them, and nothing here adds them to a figure of ours or lets one
 * of them reach Contribution Margin — a platform's conversion value has no cost
 * basis behind it (ADR-0005). It is a leaf module rather than `AdPlatformModule`
 * because that module imports this one, for the three services below.
 *
 * `PlatformMirrorService` is exported for the same one caller and is there for
 * the same reason: it is the only way a sync reaches the `ads` table, and it
 * lives here because this module owns what an Ad's `status` means. What it
 * writes is the platform's own state and placement, beside that status and
 * never over it.
 */
@Module({
  imports: [AuthModule, TenantModule, ReportedFiguresModule],
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
    SyncedSpendService,
    PlatformMirrorService,
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
    SyncedSpendService,
    PlatformMirrorService,
  ],
})
export class MarketingModule {}
