import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { CreateAdDto, ListAdsQueryDto, UpdateAdDto } from '../dto/ad.dto';

/**
 * Ad management, addressed beneath the Campaign that owns it — an Ad has no
 * meaning outside one, and naming the Campaign in the path is what scopes both
 * the lookup and the tag's uniqueness.
 *
 * There is no DELETE, for the reason there is none for a Campaign: revenue
 * already reported against an Ad would be silently re-bucketed. Archiving is the
 * only retirement path.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns/:campaignId/ads')
export class AdminAdController {
  constructor(private readonly ads: AdService) {}

  @Get()
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: "List a campaign's ads",
    description:
      'Active ads by default; pass status=archived or status=all to see the rest. A campaign with none is not incomplete — an ad is a subdivision a merchant opts into.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async list(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() query: ListAdsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    const status = query.status ?? 'active';
    return this.ads.list(
      organizationId,
      storeId,
      campaignId,
      status === 'all' ? undefined : status,
    );
  }

  @Post()
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Create an ad under a campaign',
    description:
      'Assigns a canonical tag unique within the campaign — not within the store, so every campaign is free to run a video-a — and an exact-match rule on utm_content for it, so orders arriving through a link carrying the tag resolve onto this ad without any rule authored by hand.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: 'A flight that ends before it starts',
  })
  @ApiResponse({ status: 404 })
  async create(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: CreateAdDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.create(organizationId, storeId, campaignId, dto);
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

  @Patch(':adId')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Update an ad',
    description:
      'Name, flight dates and ad-platform id. The canonical tag is fixed at creation so a link already running keeps matching.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 400,
    description: 'A flight that ends before it starts',
  })
  @ApiResponse({ status: 404 })
  async update(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @Body() dto: UpdateAdDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.update(organizationId, storeId, campaignId, adId, dto);
  }

  /**
   * The same multipart shape, validators and size ceiling the admin product
   * controller uses for product media, deliberately — a creative is an image an
   * admin uploads, and there is no reason for a second way to store one.
   */
  @Post(':adId/creative')
  @RequirePermission('campaigns.write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: "Upload an ad's creative",
    description:
      'Replaces the current creative if there is one. An ad without one is a normal ad — this is never required.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: 'Not an image, or larger than 10MB',
  })
  @ApiResponse({ status: 404 })
  async uploadCreative(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @CurrentTenant() tenant: TenantContext,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp|gif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.setCreative(
      organizationId,
      storeId,
      campaignId,
      adId,
      file,
    );
  }

  /**
   * Removing a creative is not archiving an ad. The ad goes back to the state
   * most ads are in and stays exactly as measurable as it was.
   */
  @Delete(':adId/creative')
  @RequirePermission('campaigns.write')
  @ApiOperation({ summary: "Remove an ad's creative" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async removeCreative(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.removeCreative(organizationId, storeId, campaignId, adId);
  }

  @Post(':adId/archive')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Archive an ad',
    description:
      'Removes it from the active list. It stays retrievable and keeps explaining the orders it drove.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async archive(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.archive(organizationId, storeId, campaignId, adId);
  }

  @Post(':adId/unarchive')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Return an archived ad to the active list',
    description:
      'Always deliberate and per ad: restoring a campaign does not restore the creatives the merchant retired one by one.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async unarchive(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('adId', ParseUUIDPipe) adId: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Ad> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.ads.unarchive(organizationId, storeId, campaignId, adId);
  }
}
