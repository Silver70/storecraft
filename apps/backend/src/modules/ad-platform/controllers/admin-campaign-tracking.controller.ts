import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import {
  CampaignTrackingService,
  type TrackingOutcome,
} from '../services/campaign-tracking.service';

/**
 * Start tracking: the one write to a campaign built in Ads Manager.
 *
 * It lives beside the ad platform rather than beside the campaign reads because
 * it reaches the platform. It asks for `campaigns.write`, the same as any other
 * campaign edit, since it changes what the merchant's ads carry and sends them
 * back through review.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/campaigns')
export class AdminCampaignTrackingController {
  constructor(private readonly tracking: CampaignTrackingService) {}

  /**
   * Answers with a result per ad rather than failing as a whole. An ad the
   * platform refuses is named, with the reason, beside the ones it tagged. A
   * platform failure part-way is reported in `message`, and `tracked` says
   * whether the campaign is Tracked afterwards.
   */
  @Post(':id/tracking')
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Write our link tags onto every ad of a campaign',
    description:
      'The platform treats a tag change as a new creative: each tagged ad goes back through review, and an ad made from an existing post is refused rather than rebuilt. Ads that already carry the tags are left alone, so repeating this is harmless. Only clicks after tagging are measured.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No such campaign in this store' })
  @ApiResponse({
    status: 409,
    description:
      'The store is not connected, or this campaign is already being tagged',
  })
  async startTracking(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<TrackingOutcome> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.tracking.startTracking(organizationId, storeId, id);
  }
}
