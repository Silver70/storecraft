import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  AttributedRevenueService,
  type AttributedRevenueReport,
} from '../services/attributed-revenue.service';
import { AttributedRevenueQueryDto } from '../dto/attributed-revenue.dto';

/**
 * Marketing reporting. Separate from `admin/campaigns` on purpose: that
 * controller is CRUD over one resource, this is a read across all of them, and
 * a `revenue` path segment sitting beside `:id` is a route conflict waiting for
 * someone to reorder the file.
 */
@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/marketing')
export class AdminAttributionController {
  constructor(private readonly revenue: AttributedRevenueService) {}

  @Get('attributed-revenue')
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: 'Attributed revenue and order counts by campaign',
    description:
      "Resolves each order in the period to a campaign by running the store's matching rules against the touch it froze at checkout, so a campaign created after its ads ran still claims them and a corrected rule repairs history. Unattributed is its own bucket and is never spread across campaigns. Touches older than the returned lookback window, and visitors the event log classified as bots, receive no credit but still count in the totals — which reconcile with the dashboard and analytics sales figures for the same period. Revenue is the order total (tax and shipping in, discounts already netted out) in the smallest currency unit. A campaign appears if it is active or earned revenue in the period. Each campaign line also carries `ads` — the same figures per creative, resolved in a second pass from `utm_content` over that campaign's own ads alone, so an ad can never claim a sale whose `utm_campaign` names a different campaign and two campaigns are each free to run a `video-a` — and `unassigned`, the revenue this campaign earned that no ad of its claimed. Unassigned is its own visible bucket, is never spread across the ads that exist, and is a different outcome from unattributed, which has no campaign at all. The split comes from the same read as the campaign line, so every ad's revenue plus the unassigned figure reconciles to the campaign above them; a campaign with no ads returns an empty list. **There is no cost side.** Spend, ROAS and contribution margin are not returned: spend was recorded by hand and every figure built on it was only as current as the last day a merchant remembered to enter. They return when the ad platform reports the spend itself, and nothing here stands a zero in for them in the meantime.",
  })
  @ApiResponse({ status: 200 })
  async attributedRevenue(
    @Query() query: AttributedRevenueQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AttributedRevenueReport> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.revenue.byCampaign(
      organizationId,
      storeId,
      query.period,
      query.touch ?? 'last',
    );
  }
}
