import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketingModule } from '../marketing/marketing.module';
import { TenantModule } from '../tenant/tenant.module';
import { AD_PLATFORM_PROVIDER } from './interfaces/ad-platform-provider.interface';
import { AyrshareAdapter } from './services/ayrshare.adapter';
import { AdminAdPlatformController } from './controllers/admin-ad-platform.controller';
import { AdminUnlinkedAdController } from './controllers/admin-unlinked-ad.controller';
import { AdPlatformCallbackController } from './controllers/ad-platform-callback.controller';
import { AdPlatformConnectionRepository } from './repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from './repositories/ad-platform-credential.repository';
import { AdReportedFigureRepository } from './repositories/ad-reported-figure.repository';
import { UnlinkedAdRepository } from './repositories/unlinked-ad.repository';
import { AdPlatformConnectionService } from './services/ad-platform-connection.service';
import { AdPlatformSyncService } from './services/ad-platform-sync.service';
import { ReportedFigureService } from './services/reported-figure.service';
import { UnlinkedAdService } from './services/unlinked-ad.service';
import { CredentialVault } from './services/credential-vault.service';

/**
 * A Store's access to the ad platforms it advertises on.
 *
 * The module exists so that the one place this codebase reaches an ad platform
 * has a boundary you can see from the outside: `AD_PLATFORM_PROVIDER` is the
 * seam, one adapter is bound to it here, and a test swaps that binding the same
 * way the payment provider's is swapped. Nothing outside this module imports
 * the adapter, and nothing inside it except the adapter knows the vendor's name.
 *
 * `TenantModule` is imported for the Store the credential is issued against,
 * and for the timezone a Reported Figure's day is resolved in — the merchant's
 * day, which is the day their Spend is recorded against and the day the
 * platform is reporting.
 *
 * `MarketingModule` is imported for one reason: claiming an Unlinked Ad creates
 * an Ad under a Campaign, and it does so through `AdService` rather than
 * through an insert of its own, so the Ad Tag derivation, the per-Campaign
 * uniqueness and the canonical `utm_content` rule are the same ones a
 * hand-created Ad gets. A second implementation of that would drift, and the
 * thing it would drift away from is the only reason a claimed ad can ever earn
 * revenue.
 *
 * **`SyncedSpendService` is the only door from this module into
 * `campaign_spend`, and nothing here may open another.** Neither
 * `CampaignSpendRepository` nor `CampaignSpendService` is injected anywhere in
 * this module, and that is the check to make on any change here.
 *
 * What goes through that door is spend and nothing else: what the ad account
 * was charged, written against the Ad that claims the platform's ad, labelled
 * `synced` on the row, and declined outright on a day the merchant pinned. The
 * platform's reported **revenue, conversions and ROAS do not go through it at
 * all** — they stay in `ad_reported_figures`, displayed beside ours and never
 * merged into them, and never an input to Contribution Margin (ADR-0005).
 */
@Module({
  imports: [AuthModule, TenantModule, MarketingModule],
  controllers: [
    AdminAdPlatformController,
    AdminUnlinkedAdController,
    AdPlatformCallbackController,
  ],
  providers: [
    {
      provide: AD_PLATFORM_PROVIDER,
      useClass: AyrshareAdapter,
    },
    CredentialVault,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdReportedFigureRepository,
    UnlinkedAdRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    ReportedFigureService,
    UnlinkedAdService,
  ],
  exports: [
    AD_PLATFORM_PROVIDER,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdReportedFigureRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    ReportedFigureService,
    UnlinkedAdRepository,
    UnlinkedAdService,
    CredentialVault,
  ],
})
export class AdPlatformModule {}
