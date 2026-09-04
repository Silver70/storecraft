import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import type {
  Campaign,
  CampaignMatchingRule,
} from '../../../shared/database/schema';
import {
  CampaignService,
  type CampaignTaggedLink,
} from '../services/campaign.service';
import {
  CreateCampaignDto,
  CreateCampaignRuleDto,
  GenerateCampaignLinkQueryDto,
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

  // ─── Tagged links ───────────────────────────────────────────────────────────

  @Get(':id/link')
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: 'Generate a tagged link for a campaign',
    description:
      "Composes the URL to paste into an ad platform: a page of the store, the chosen source and medium, and the campaign's own canonical tag. Because the tag comes from the campaign rather than from typing, traffic through the link is attributed with no rule authored by hand — and links differing only by source or medium all report as the same campaign. Nothing is stored: the link is derived, so generating it again gives the same URL.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 400,
    description: 'Unusable destination or parameter',
  })
  @ApiResponse({ status: 404 })
  async generateLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GenerateCampaignLinkQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignTaggedLink> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.generateLink(organizationId, storeId, id, query);
  }

  // ─── Matching rules ─────────────────────────────────────────────────────────

  @Get(':id/rules')
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: "List a campaign's matching rules",
    description:
      'The canonical rule on the campaign tag first, then whatever the merchant has added.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async listRules(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignMatchingRule[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.listRules(organizationId, storeId, id);
  }

  @Post(':id/rules')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Add a matching rule',
    description:
      'Teaches the campaign to claim a UTM variant. Comparison ignores case, hyphens, underscores and spacing, so one rule covers every way the same value was tagged. Adding a rule repairs historical reports as well as future ones, because attribution is resolved at read time.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Value can never match anything' })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Already matched by another rule' })
  async addRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCampaignRuleDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignMatchingRule> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.campaigns.addRule(organizationId, storeId, id, dto);
  }

  @Delete(':id/rules/:ruleId')
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a matching rule',
    description:
      "The campaign's own tag rule is not removable: every link generated from the campaign carries that tag.",
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'The canonical tag rule' })
  async removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<void> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    await this.campaigns.removeRule(organizationId, storeId, id, ruleId);
  }
}
