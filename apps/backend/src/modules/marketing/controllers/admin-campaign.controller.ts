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
import type { Campaign } from '../../../shared/database/schema';
import { CampaignService } from '../services/campaign.service';

/**
 * The Store's Campaigns, as the ad platform describes them. Reads only: a
 * Campaign is created and changed on the platform, and there is no DELETE — a
 * campaign deleted there reads Ended here and keeps its history.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns')
export class AdminCampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({ summary: 'List campaigns for the active store' })
  @ApiResponse({ status: 200 })
  async list(@CurrentTenant() tenant: TenantContext): Promise<Campaign[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.list(organizationId, storeId);
  }

  @Get(':id')
  @RequirePermission('campaigns.read')
  @ApiOperation({ summary: 'Get a campaign by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.get(organizationId, storeId, id);
  }
}
