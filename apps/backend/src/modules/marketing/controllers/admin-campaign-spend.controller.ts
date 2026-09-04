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
import type { CampaignSpend } from '../../../shared/database/schema';
import {
  CampaignSpendService,
  type CampaignSpendReport,
} from '../services/campaign-spend.service';
import {
  ListCampaignSpendQueryDto,
  RecordCampaignSpendDto,
  UpdateCampaignSpendDto,
} from '../dto/campaign-spend.dto';

/**
 * What a campaign cost, recorded by hand.
 *
 * Its own controller rather than more routes on `admin/campaigns`: spend is a
 * collection under one campaign with its own lifecycle, and giving it a base
 * path of its own keeps `:id` from acquiring a fourth sub-resource whose route
 * order has to be reasoned about (the rules controller already carries that
 * caveat).
 *
 * Reads take `campaigns.read` and writes take `campaigns.write`, which is what
 * keeps cost data out of a support agent's hands: they can read an order and
 * they cannot change what an ad was worth.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns/:campaignId/spend')
export class AdminCampaignSpendController {
  constructor(private readonly spend: CampaignSpendService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: "List a campaign's spend for a period",
    description:
      "Oldest day first, in the smallest currency unit and never formatted. The period's timestamp range is converted to calendar days in the store's timezone, using the same period helper the attributed-revenue read uses, so spend and revenue always describe the same window. The response also carries the store's currency and today's date where the store is — the two facts an entry form needs to be correct, and neither of which the browser can be trusted for.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async list(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() query: ListCampaignSpendQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpendReport> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.list(
      organizationId,
      storeId,
      campaignId,
      query.period ?? '30d',
    );
  }

  @Post()
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: "Record a day's spend",
    description:
      "A correction, not an addition: a day that already has a figure is replaced, so the same request sent twice leaves one row holding the last amount. Refused if the amount is negative, if the day is in the future where the store is, or if the currency is not the store's — there is no conversion anywhere in this feature. An archived campaign accepts spend: closing out a finished campaign's real cost is normal.",
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: 'Negative amount, future or malformed day, or wrong currency',
  })
  @ApiResponse({ status: 404 })
  async record(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: RecordCampaignSpendDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpend> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.record(organizationId, storeId, campaignId, dto);
  }

  @Patch(':spendId')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Correct a spend row',
    description:
      "The amount and the note. The day is not editable — moving a figure is recording it on the day it belongs to, which corrects that day, and deleting the row entered by mistake. Nor is the currency, which is the store's and frozen on the row.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Negative amount' })
  @ApiResponse({ status: 404 })
  async update(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('spendId', ParseUUIDPipe) spendId: string,
    @Body() dto: UpdateCampaignSpendDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpend> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.update(organizationId, storeId, campaignId, spendId, dto);
  }

  @Delete(':spendId')
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a spend row',
    description:
      'Deletable, unlike a campaign: a figure entered against the wrong campaign should be removed rather than zeroed, because a zero claims the campaign ran that day and cost nothing.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404 })
  async remove(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('spendId', ParseUUIDPipe) spendId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<void> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    await this.spend.remove(organizationId, storeId, campaignId, spendId);
  }
}
