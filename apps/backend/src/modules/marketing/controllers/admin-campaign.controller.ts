import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import type { Campaign } from '../../../shared/database/schema';
import { CampaignService } from '../services/campaign.service';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  UpdateCampaignDto,
} from '../dto/campaign.dto';

/**
 * Campaign management. There is no DELETE: a Campaign explains Orders that have
 * already been reported, and archiving is the way to retire one without moving
 * that revenue into Unattributed behind the merchant's back.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns')
export class AdminCampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: 'List campaigns for the active store',
    description:
      'Active campaigns by default; pass status=archived or status=all to see the rest.',
  })
  @ApiResponse({ status: 200 })
  async list(
    @Query() query: ListCampaignsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    const status = query.status ?? 'active';
    return this.campaigns.list(
      organizationId,
      storeId,
      status === 'all' ? undefined : status,
    );
  }

  @Post()
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Create a campaign',
    description:
      'Assigns a canonical tag unique within the store and an exact-match rule on it, so links generated from the campaign are attributed without any rule authored by hand.',
  })
  @ApiResponse({ status: 201 })
  async create(
    @Body() dto: CreateCampaignDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.create(organizationId, storeId, dto);
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

  @Patch(':id')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Update a campaign',
    description:
      'Name, platform and ad-platform id. The canonical tag is fixed at creation so links already live keep matching.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.update(organizationId, storeId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Archive a campaign',
    description:
      'Removes it from the active list. It stays retrievable and keeps explaining the orders it drove.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.archive(organizationId, storeId, id);
  }

  @Post(':id/unarchive')
  @RequirePermission('campaigns.write')
  @ApiOperation({ summary: 'Return an archived campaign to the active list' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.unarchive(organizationId, storeId, id);
  }
}
