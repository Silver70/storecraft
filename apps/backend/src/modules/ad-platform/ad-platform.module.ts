import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { AD_PLATFORM_PROVIDER } from './interfaces/ad-platform-provider.interface';
import { ZernioAdPlatformAdapter } from './services/zernio.adapter';
import { AdminAdPlatformController } from './controllers/admin-ad-platform.controller';
import { AdPlatformCallbackController } from './controllers/ad-platform-callback.controller';
import { AdminCampaignTrackingController } from './controllers/admin-campaign-tracking.controller';
import { AdminCampaignCreationController } from './controllers/admin-campaign-creation.controller';
import { AdPlatformConnectionRepository } from './repositories/ad-platform-connection.repository';
import { AdPlatformCredentialRepository } from './repositories/ad-platform-credential.repository';
import { CampaignMirrorRepository } from './repositories/campaign-mirror.repository';
import { CampaignDraftRepository } from './repositories/campaign-draft.repository';
import { PurchaseEventDispatchRepository } from './repositories/purchase-event-dispatch.repository';
import { AdPlatformConnectionService } from './services/ad-platform-connection.service';
import { AdPlatformSyncService } from './services/ad-platform-sync.service';
import { CampaignTrackingService } from './services/campaign-tracking.service';
import { CampaignCreationService } from './services/campaign-creation.service';
import { CredentialVault } from './services/credential-vault.service';
import { MeasurementService } from './services/measurement.service';
import { PurchaseEventService } from './services/purchase-event.service';
import { PurchaseEventHandler } from './services/purchase-event.handler';
import { MeasurementResolver } from './resolvers/measurement.resolver';
import { R2StorageService } from '../../shared/storage/r2-storage.service';

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
 * **The sync is the only writer of what the platform reports.** Campaigns and
 * Ads discovered on the ad account, their status, whether each Ad carries our
 * Link Tags, a copy of each creative, and each Ad's daily spend, impressions
 * and link clicks in `ad_daily_figures` — all keyed by the platform's own ids
 * rather than by a tag a merchant had to paste correctly, and all written by
 * `CampaignMirrorRepository`. Object storage is provided here for the creative
 * copies, as the product module provides it for product media.
 *
 * Two things write to the platform, and only when a merchant asks.
 * `CampaignCreationService` creates a campaign with every ad already carrying
 * the Link Tags, and records it here straight away rather than waiting for the
 * sync. `CampaignTrackingService` writes the tags onto a discovered campaign's
 * ads when a merchant presses Start tracking.
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
  controllers: [
    AdminAdPlatformController,
    AdPlatformCallbackController,
    AdminCampaignTrackingController,
    AdminCampaignCreationController,
  ],
  providers: [
    {
      provide: AD_PLATFORM_PROVIDER,
      useClass: ZernioAdPlatformAdapter,
    },
    CredentialVault,
    AdPlatformConnectionRepository,
    AdPlatformCredentialRepository,
    CampaignMirrorRepository,
    CampaignDraftRepository,
    PurchaseEventDispatchRepository,
    R2StorageService,
    AdPlatformConnectionService,
    AdPlatformSyncService,
    CampaignTrackingService,
    CampaignCreationService,
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
