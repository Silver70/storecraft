import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { RbacGuard } from '../../auth/guards/rbac.guard';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import type { TenantContext } from '../../../shared/tenant/tenant-context';
import { requireStoreContext } from '../../../shared/tenant/tenant.util';
import {
  AdPlatformConnectionService,
  type AdAccountChoice,
  type AdPlatformConnectionView,
} from '../services/ad-platform-connection.service';
import {
  AdPlatformSyncService,
  type SyncOutcome,
} from '../services/ad-platform-sync.service';
import {
  AdPlatformParamDto,
  BeginConnectionDto,
  SelectAdAccountDto,
} from '../dto/ad-platform.dto';

/**
 * Connecting a Store to an ad platform, seeing what it is connected to, and
 * disconnecting.
 *
 * Store-scoped throughout, and that is the point rather than a convention: a US
 * store and a UK store hold separate connections to separate ad accounts, and
 * neither can read the other's. No response on this controller can carry a
 * credential — the view type has no field for one.
 *
 * ## Why the read and the write ask for different things
 *
 * Granting a third party standing access to an ad account is an owner's
 * decision, in the same class as issuing an API key — so connecting, choosing
 * the account and disconnecting all need `super_admin`. Reading which account a
 * store is connected to is part of reading the campaigns page, so it asks for
 * exactly what that page asks for: `campaigns.read`. A product manager who can
 * see every campaign and every figure would otherwise be unable to see which
 * account produced them.
 */
@ApiTags('Ad platforms')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/ad-platforms')
export class AdminAdPlatformController {
  constructor(
    private readonly connections: AdPlatformConnectionService,
    private readonly sync: AdPlatformSyncService,
  ) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: "List a store's ad-platform connections",
    description:
      'What this store is connected to and when access was last granted. A disconnected platform is still listed, because what it recorded is still here.',
  })
  @ApiResponse({ status: 200 })
  async list(
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdPlatformConnectionView[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.connections.list(organizationId, storeId);
  }

  @Post(':platform/connect')
  @RequirePermission('ad_platforms.write')
  @ApiOperation({
    summary: 'Start connecting this store to an ad platform',
    description:
      "Returns the platform's own approval and account-selection link. The merchant approves there with their own credentials; nothing is recorded here until they come back and the platform says what they picked.",
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404, description: 'Unknown store' })
  @ApiResponse({
    status: 503,
    description: 'The ad platform could not be reached',
  })
  async connect(
    @Param() params: AdPlatformParamDto,
    @Body() dto: BeginConnectionDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{ approvalUrl: string }> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.connections.begin(
      organizationId,
      storeId,
      params.platform,
      dto.returnPath,
    );
  }

  /**
   * The ad accounts the approved login can see, each already judged.
   *
   * Every one is listed, including the ones that cannot be used and the reason
   * why. An account left out of this list is a merchant wondering whether they
   * approved with the wrong login, and going back through the platform to find
   * out.
   */
  @Get(':platform/ad-accounts')
  @RequirePermission('ad_platforms.write')
  @ApiOperation({
    summary: 'List the ad accounts this store could report against',
    description:
      "Read after the merchant comes back from the platform. Accounts billed in a currency other than the store's are listed but cannot be selected, and carry the reason — figures are never converted.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 404,
    description: 'This store has not approved this platform',
  })
  async adAccounts(
    @Param() params: AdPlatformParamDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdAccountChoice[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.connections.adAccounts(
      organizationId,
      storeId,
      params.platform,
    );
  }

  /**
   * Records which ad account this store reports against.
   *
   * The currency check happens here and not only in the picker: a mismatched
   * account refused on screen and accepted by a hand-made request would put
   * spend in one currency beside revenue in another, and every ROAS on the page
   * would be wrong by a rate nobody chose.
   */
  @Post(':platform/account')
  @RequirePermission('ad_platforms.write')
  @ApiOperation({
    summary: 'Choose the ad account this store reports against',
    description:
      'Completes the connection: the account is recorded with its name and currency, and its pixel is found or created and named after the store. An account in another currency is refused with the reason.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: "The account's currency is not the store's",
  })
  @ApiResponse({ status: 404, description: 'No such account on this grant' })
  async selectAccount(
    @Param() params: AdPlatformParamDto,
    @Body() dto: SelectAdAccountDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdPlatformConnectionView> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.connections.selectAccount(
      organizationId,
      storeId,
      params.platform,
      dto.accountId,
    );
  }

  @Post(':platform/disconnect')
  @RequirePermission('ad_platforms.write')
  @ApiOperation({
    summary: 'Disconnect an ad platform from this store',
    description:
      'Revokes access and destroys the credential. Everything already recorded survives: the connection is marked disconnected, never deleted, so no past report is rewritten.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async disconnect(
    @Param() params: AdPlatformParamDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdPlatformConnectionView> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.connections.disconnect(
      organizationId,
      storeId,
      params.platform,
    );
  }

  /**
   * A sync the merchant asked for, without waiting for the schedule.
   *
   * Answers with what happened rather than throwing it. A platform that refuses
   * the call is a sentence on the page, not a 500 on a button — and the
   * sentence does not blame the merchant's account, because a shared upstream
   * quota has nothing to do with it.
   */
  @Post('sync')
  @RequirePermission('ad_platforms.sync')
  @ApiOperation({
    summary: "Pull this store's figures from every connected ad platform now",
    description:
      'Runs the same sync the schedule runs, immediately. A failure is reported in the response and recorded on the connection; nothing already recorded is changed by one. The outcome names the range that was asked for.',
  })
  @ApiResponse({ status: 201 })
  async syncAll(
    @CurrentTenant() tenant: TenantContext,
  ): Promise<SyncOutcome[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.sync.syncStore(organizationId, storeId);
  }

  @Post(':platform/sync')
  @RequirePermission('ad_platforms.sync')
  @ApiOperation({
    summary: "Pull one platform's figures for this store now",
  })
  @ApiResponse({ status: 201 })
  async syncPlatform(
    @Param() params: AdPlatformParamDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<SyncOutcome[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.sync.syncStore(organizationId, storeId, params.platform);
  }
}
