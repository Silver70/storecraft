import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { AD_PLATFORM_PROVIDER } from './interfaces/ad-platform-provider.interface';
import { ZernioAdPlatformAdapter } from './services/zernio.adapter';
import { AdminAdPlatformController } from './controllers/admin-ad-platform.controller';
import { AdPlatformCallbackController } from './controllers/ad-platform-callback.controller';
import { AdPlatformConnectionRepository } from './repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from './repositories/ad-platform-credential.repository';
import { PurchaseEventDispatchRepository } from './repositories/purchase-event-dispatch.repository';
import { AdPlatformConnectionService } from './services/ad-platform-connection.service';
import { AdPlatformSyncService } from './services/ad-platform-sync.service';
import { CredentialVault } from './services/credential-vault.service';
import { MeasurementService } from './services/measurement.service';
import { PurchaseEventService } from './services/purchase-event.service';
import { PurchaseEventHandler } from './services/purchase-event.handler';
import { MeasurementResolver } from './resolvers/measurement.resolver';

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
 * for the currency an ad account has to match, and for the timezone the
 * platform's day is resolved in — the merchant's day, which is the day the
 * platform is reporting.
 *
 * **Nothing here writes a Campaign, an Ad or a figure yet.** The sync reads
 * the ad tree and records how it went; writing what it read — discovered
 * Campaigns and Ads, their status, and each Ad's daily spend, impressions and
 * clicks into `ad_daily_figures` — is the sync's next job, keyed by the
 * platform's own ids rather than by a tag a merchant had to paste correctly.
 *
 * Measurement flows the other way from the same seam. `MeasurementService`
 * answers the storefront's question about which Pixel to load, and
 * `PurchaseEventService` reports every paid Order back — the two halves of the
 * one guarantee that connecting an ad platform is the whole of switching
 * measurement on. Both are held to the rule attribution already lives under:
 * they may cost a report, never a sale.
 *
 * A deployment with no integration configured still boots: the adapter reads
 * its key lazily, so only a merchant who presses Connect is told there is none.
 */
@Module({
  imports: [AuthModule, TenantModule],
  controllers: [AdminAdPlatformController, AdPlatformCallbackController],
  providers: [
    {
      provide: AD_PLATFORM_PROVIDER,
      useClass: ZernioAdPlatformAdapter,
    },
    CredentialVault,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    PurchaseEventDispatchRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    MeasurementService,
    MeasurementResolver,
    PurchaseEventService,
    PurchaseEventHandler,
  ],
  exports: [
    AD_PLATFORM_PROVIDER,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    CredentialVault,
    MeasurementService,
    PurchaseEventService,
    PurchaseEventDispatchRepository,
  ],
})
export class AdPlatformModule {}
