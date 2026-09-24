import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
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
import { CampaignAdDto } from '../dto/create-campaign.dto';
import {
  SetCoverDto,
  SetDeliveryDto,
  UpdateCampaignDto,
} from '../dto/edit-campaign.dto';
import {
  CampaignEditService,
  type AddAdOutcome,
} from '../services/campaign-edit.service';

/**
 * Changing a running campaign at the ad platform: rename, budget, end date,
 * pause and resume, pause and resume one ad, add an ad, and the Cover. Nothing
 * else — there is no audience, goal or creative edit and no DELETE, on purpose.
 *
 * Every route answers with the campaign as it now stands here, recorded as
 * soon as the platform accepted the change. A 422 carries the platform's own
 * words, placed on the field they are about, and nothing was changed. Every
 * route asks for `campaigns.write`.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns')
export class AdminCampaignEditController {
  constructor(private readonly edits: CampaignEditService) {}

  @Patch(':id')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Rename a campaign, change its daily budget, or its end date',
    description:
      'Each field is optional. A budget that lives on the ad sets, or a lifetime budget, is refused: it is changed in Ads Manager.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'Meta is not connected' })
  @ApiResponse({ status: 422, description: 'What is wrong, by field' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.edits.update(organizationId, storeId, id, dto);
  }

  @Put(':id/status')
  @RequirePermission('campaigns.write')
  @ApiOperation({ summary: 'Pause or resume a campaign' })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 409,
    description: 'Not connected, or the campaign has ended',
  })
  async setDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDeliveryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.edits.setDelivery(organizationId, storeId, id, dto.status);
  }

  @Put(':id/ads/:adId/status')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Pause or resume one ad, leaving the others as they are',
  })
  @ApiResponse({ status: 200 })
  async setAdDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Body() dto: SetDeliveryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.edits.setAdDelivery(
      organizationId,
      storeId,
      id,
      adId,
      dto.status,
    );
  }

  /**
   * Answers 201 with the ad as it was stored, or 422 with the complaints about
   * it. Retrying with the same key answers with the ad already added.
   */
  @Post(':id/ads')
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an ad to a running campaign',
    description:
      'The same ad as the create form takes. It is created carrying the link tags, and joins the ad set where the campaign already spends.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 422, description: 'What is wrong with the ad' })
  async addAd(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CampaignAdDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AddAdOutcome> {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 255) {
      throw new BadRequestException(
        'An Idempotency-Key header of up to 255 characters is required, so a retried add cannot make a second ad.',
      );
    }
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.edits.addAd(organizationId, storeId, id, dto, key);
  }

  @Put(':id/cover')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Choose the cover: one of the campaign’s ads, or an upload',
  })
  @ApiResponse({ status: 200 })
  async setCover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCoverDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Campaign> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.edits.setCover(organizationId, storeId, id, dto);
  }
}
