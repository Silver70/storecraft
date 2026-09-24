import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
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
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import {
  CampaignCreationService,
  MAX_VIDEO_UPLOAD_BYTES,
  type CreateCampaignOutcome,
} from '../services/campaign-creation.service';

/**
 * Creating a campaign here, at the ad platform. It lives beside the ad
 * platform rather than beside the campaign reads because it reaches the
 * platform, and it asks for `campaigns.write` like every other campaign write.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns')
export class AdminCampaignCreationController {
  constructor(private readonly creation: CampaignCreationService) {}

  /**
   * Answers 201 with the campaign as it was stored, or 422 with every
   * complaint (the rules here, the platform's dry run, or the platform's
   * refusal), each placed by field and by ad. Nothing is created on a 422.
   */
  @Post()
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a campaign at the ad platform',
    description:
      'Checked against the platform’s dry run first. Every ad is created carrying the link tags. Retrying with the same Idempotency-Key answers with the campaign already created.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 409,
    description: 'Not connected, or already being created',
  })
  @ApiResponse({ status: 422, description: 'What is wrong, by field and ad' })
  async create(
    @Body() dto: CreateCampaignDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CreateCampaignOutcome> {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 255) {
      throw new BadRequestException(
        'An Idempotency-Key header of up to 255 characters is required, so a retried create cannot make a second campaign.',
      );
    }
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.creation.create(organizationId, storeId, dto, key);
  }

  /** Stores a picture or video to make an ad from, and answers with its URL. */
  @Post('creatives')
  @RequirePermission('campaigns.write')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_VIDEO_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image or video for an ad' })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{ url: string; kind: 'image' | 'video' }> {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.creation.upload(organizationId, storeId, file);
  }
}
