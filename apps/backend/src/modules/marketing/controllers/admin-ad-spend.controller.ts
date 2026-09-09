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
  RecordCampaignSpendRangeDto,
  UpdateCampaignSpendDto,
} from '../dto/campaign-spend.dto';

/**
 * What one creative cost, rather than what the whole push cost.
 *
 * The same collection as `AdminCampaignSpendController` at a finer grain, and
 * deliberately the same shapes: the same DTOs, the same service, the same
 * refusals, the same correcting upsert. An ad's spend is not a different kind
 * of fact from a campaign's, and giving it its own vocabulary would invite the
 * two to drift apart on the one thing they must agree about — what the push
 * cost.
 *
 * Addressed beneath the ad, which is itself addressed beneath its campaign, so
 * the path states the whole scope. Both ids are checked: an ad belonging to a
 * sibling campaign is a 404, never a row whose ad and campaign point at
 * different pushes.
 *
 * A campaign-level figure and an ad-level figure for the same day are two
 * different facts and coexist — the campaign's is the part whose split is not
 * known, not a total of the ads beneath it. Sending either twice corrects it.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns/:campaignId/ads/:adId/spend')
export class AdminAdSpendController {
  constructor(private readonly spend: CampaignSpendService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: "List one ad's spend for a period",
    description:
      "This creative's rows alone, oldest day first, in the smallest currency unit and never formatted. For the whole push — this ad, its siblings and the campaign-level rows whose split is not known — read the campaign's spend instead, which spans both grains.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async list(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Query() query: ListCampaignSpendQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpendReport> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.list(
      { organizationId, storeId, campaignId, adId },
      query.period ?? '30d',
    );
  }

  @Post()
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: "Record a day's spend against an ad",
    description:
      "A correction, not an addition: this ad's figure for that day is replaced, so the same request sent twice leaves one row holding the last amount. It does not touch the campaign-level figure for the same day, nor a sibling ad's — the three coexist and are all counted. The same refusals as campaign-level entry: no negative amount, no future day, the store's currency only. An archived ad accepts spend, so a finished creative's real cost can be closed out.",
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: 'Negative amount, future or malformed day, or wrong currency',
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown campaign, or an ad that is not under it',
  })
  async record(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Body() dto: RecordCampaignSpendDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpend> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.record(
      { organizationId, storeId, campaignId, adId },
      dto,
    );
  }

  @Post('range')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Record one total across a range of days against an ad',
    description:
      'Exactly as the campaign-level range works, one grain down: one row per day for this ad, the total divided in minor units with the remainder on the first day so the rows sum to exactly what was submitted, and every day in the range corrected rather than added to.',
  })
  @ApiResponse({ status: 201, description: 'The rows written, oldest first' })
  @ApiResponse({
    status: 400,
    description:
      'Negative total, future or malformed day, wrong currency, inverted range, or a range that is too long',
  })
  @ApiResponse({ status: 404 })
  async recordRange(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Body() dto: RecordCampaignSpendRangeDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpend[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.recordRange(
      { organizationId, storeId, campaignId, adId },
      dto,
    );
  }

  @Patch(':spendId')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: "Correct one of this ad's spend rows",
    description:
      'The amount and the note, as at the campaign level. The ad in the path is a boundary rather than a decoration: a row recorded against the campaign as a whole, or against a sibling ad, is not reachable here.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Negative amount' })
  @ApiResponse({ status: 404 })
  async update(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Param('spendId', ParseUUIDPipe) spendId: string,
    @Body() dto: UpdateCampaignSpendDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignSpend> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.spend.update(
      { organizationId, storeId, campaignId, adId },
      spendId,
      dto,
    );
  }

  @Delete(':spendId')
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Remove one of this ad's spend rows",
    description:
      'Deletable, unlike the ad itself: a figure entered against the wrong creative should be removed rather than zeroed, because a zero claims the creative ran that day and cost nothing.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404 })
  async remove(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Param('spendId', ParseUUIDPipe) spendId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<void> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    await this.spend.remove(
      { organizationId, storeId, campaignId, adId },
      spendId,
    );
  }
}
