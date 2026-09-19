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
  type AdPlatformConnectionView,
} from '../services/ad-platform-connection.service';
import { AdPlatformParamDto, BeginConnectionDto } from '../dto/ad-platform.dto';

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
  constructor(private readonly connections: AdPlatformConnectionService) {}

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
}
