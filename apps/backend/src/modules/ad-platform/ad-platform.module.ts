import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { AD_PLATFORM_PROVIDER } from './interfaces/ad-platform-provider.interface';
import { AyrshareAdapter } from './services/ayrshare.adapter';
import { AdminAdPlatformController } from './controllers/admin-ad-platform.controller';
import { AdPlatformCallbackController } from './controllers/ad-platform-callback.controller';
import { AdPlatformConnectionRepository } from './repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from './repositories/ad-platform-credential.repository';
import { AdReportedFigureRepository } from './repositories/ad-reported-figure.repository';
import { AdPlatformConnectionService } from './services/ad-platform-connection.service';
import { AdPlatformSyncService } from './services/ad-platform-sync.service';
import { ReportedFigureService } from './services/reported-figure.service';
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
 * The sync writes `ad_reported_figures` and nothing else. **`campaign_spend` is
 * not reachable from this module**, and that is ADR-0005 made structural: the
 * merchant's book of record and the platform's are separate tables behind
 * separate repositories, with no code path from one into the other.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [AdminAdPlatformController, AdPlatformCallbackController],
  providers: [
    {
      provide: AD_PLATFORM_PROVIDER,
      useClass: AyrshareAdapter,
    },
    CredentialVault,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdReportedFigureRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    ReportedFigureService,
  ],
  exports: [
    AD_PLATFORM_PROVIDER,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdReportedFigureRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    ReportedFigureService,
    CredentialVault,
  ],
})
export class AdPlatformModule {}
