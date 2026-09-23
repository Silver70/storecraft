import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { AD_PLATFORM_PROVIDER } from './interfaces/ad-platform-provider.interface';
import { UnconfiguredAdPlatformAdapter } from './services/unconfigured-ad-platform.adapter';
import { AdminAdPlatformController } from './controllers/admin-ad-platform.controller';
import { AdPlatformCallbackController } from './controllers/ad-platform-callback.controller';
import { AdPlatformConnectionRepository } from './repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from './repositories/ad-platform-credential.repository';
import { AdPlatformConnectionService } from './services/ad-platform-connection.service';
import { AdPlatformSyncService } from './services/ad-platform-sync.service';
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
 * Right now the adapter bound here knows no vendor at all — see
 * `UnconfiguredAdPlatformAdapter`. The one that was here was a vendor nobody
 * chose and it has been deleted rather than ported.
 *
 * `TenantModule` is imported for the Store the credential is issued against,
 * and for the timezone the platform's day is resolved in — the merchant's day,
 * which is the day the platform is reporting.
 *
 * **Nothing here writes a Campaign, an Ad or a figure yet.** The sync reads
 * the ad tree and records how it went; writing what it read — discovered
 * Campaigns and Ads, their status, and each Ad's daily spend, impressions and
 * clicks into `ad_daily_figures` — is the sync's next job, keyed by the
 * platform's own ids rather than by a tag a merchant had to paste correctly.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [AdminAdPlatformController, AdPlatformCallbackController],
  providers: [
    {
      provide: AD_PLATFORM_PROVIDER,
      useClass: UnconfiguredAdPlatformAdapter,
    },
    CredentialVault,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
  ],
  exports: [
    AD_PLATFORM_PROVIDER,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    CredentialVault,
  ],
})
export class AdPlatformModule {}
