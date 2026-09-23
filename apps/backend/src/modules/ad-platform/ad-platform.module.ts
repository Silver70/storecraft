import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketingModule } from '../marketing/marketing.module';
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
 * `MarketingModule` is imported for one thing, `PlatformMirrorService`: the
 * only door from this module into `ads`. Through it a sync writes the
 * platform's own state and placement onto the Ads that claim the platform's
 * ads — and **it cannot write `ads.status`**, which is why `AdRepository.update`
 * is injected nowhere in this module. An ad rejected or paused at the platform
 * stays exactly as active here as the merchant left it, and that pairing is the
 * whole payoff of the sync.
 *
 * **Nothing here writes a figure.** The platform's spend used to be dropped
 * into the merchant's own hand-kept book and its revenue, conversions and ROAS
 * held in a table of their own to be printed beside ours; both are gone, along
 * with the queue of ads nothing here claimed. What the platform reports will
 * come back as the only figures on the page rather than as a second opinion on
 * them.
 */
@Module({
  imports: [AuthModule, TenantModule, MarketingModule],
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
