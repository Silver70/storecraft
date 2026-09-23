import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import type { Ad } from '../../../shared/database/schema';
import { AdService } from '../services/ad.service';

/**
 * A Campaign's Ads, addressed beneath it — an Ad has no meaning outside its
 * Campaign, and naming the Campaign in the path is what scopes the lookup.
 * Reads only, for the reason Campaigns are.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns/:campaignId/ads')
export class AdminAdController {
  constructor(private readonly ads: AdService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({ summary: "List a campaign's ads" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async list(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.list(organizationId, storeId, campaignId);
  }

  @Get(':adId')
  @RequirePermission('campaigns.read')
  @ApiOperation({ summary: 'Get an ad by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async findOne(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.get(organizationId, storeId, campaignId, adId);
  }
}
