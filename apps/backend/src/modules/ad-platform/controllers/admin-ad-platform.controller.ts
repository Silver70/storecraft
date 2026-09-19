import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  type AdPlatformConnectionView,
} from '../services/ad-platform-connection.service';
import {
  AdPlatformSyncService,
  type SyncOutcome,
} from '../services/ad-platform-sync.service';
import {
  ReportedFigureService,
  type ReportedFigureView,
} from '../services/reported-figure.service';
import {
  AdPlatformParamDto,
  BeginConnectionDto,
  ReportedFigureQueryDto,
} from '../dto/ad-platform.dto';

/**
 * Connecting a Store to an ad platform, seeing what it is connected to, and
 * disconnecting.
 *
 * Store-scoped throughout, and that is the point rather than a convention: a US
 * store and a UK store hold separate connections to separate ad accounts, and
 * neither can read the other's. No response on this controller can carry a
 * credential — the view type has no field for one.
 */
@ApiTags('Ad platforms')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/ad-platforms')
export class AdminAdPlatformController {
  constructor(
    private readonly connections: AdPlatformConnectionService,
    private readonly sync: AdPlatformSyncService,
    private readonly figures: ReportedFigureService,
  ) {}

  @Get()
  @RequirePermission('ad_platforms.read')
  @ApiOperation({
    summary: "List a store's ad-platform connections",
    description:
      'What this store is connected to and when access was last granted. A disconnected platform is still listed, because the figures it produced are still on the page.',
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

  @Post(':platform/disconnect')
  @RequirePermission('ad_platforms.write')
  @ApiOperation({
    summary: 'Disconnect an ad platform from this store',
    description:
      'Revokes access and destroys the credential. Everything already pulled survives: the connection is marked disconnected, never deleted, so no past report is rewritten.',
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
   * The platform's own figures, per platform ad per day.
   *
   * A read of our own database and never of the ad platform, which is what lets
   * a vendor outage cost freshness rather than the page: these rows survive a
   * failed sync untouched, and how stale they are is told by `lastSyncedAt` on
   * the connection above rather than by trying the vendor again here.
   *
   * Declared before `:platform/...` so a literal path is never read as a
   * platform name.
   */
  @Get('reported-figures')
  @RequirePermission('ad_platforms.read')
  @ApiOperation({
    summary: "The ad platform's own reported figures for this store",
    description:
      "What the platform says each of its ads spent and earned, per day, in the ad account's currency — which may not be the store's. Stored beside our own figures and never merged into them: these are the platform's numbers, on the platform's attribution window, and the two are expected to disagree.",
  })
  @ApiResponse({ status: 200 })
  async reportedFigures(
    @Query() query: ReportedFigureQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ReportedFigureView[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.figures.list(organizationId, storeId, query);
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
      'Runs the same sync the schedule runs, immediately. A failure is reported in the response and recorded on the connection; nothing already pulled is changed by one.',
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
