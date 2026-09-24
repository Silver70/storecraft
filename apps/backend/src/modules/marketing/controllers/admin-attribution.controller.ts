import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  AttributedRevenueService,
  type AttributedRevenueReport,
  type CampaignPerformanceReport,
} from '../services/attributed-revenue.service';
import {
  AttributedRevenueQueryDto,
  CampaignPerformanceQueryDto,
} from '../dto/attributed-revenue.dto';

/**
 * Marketing reporting. Separate from `admin/campaigns` on purpose: that
 * controller reads one resource, this is a read across all of them, and
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
    summary: 'Attributed revenue, orders and platform figures by campaign',
    description:
      "Credits each order in the period to the latest ad click: the last touch if its utm_campaign is the platform id of one of this store's campaigns, otherwise the first touch if that is. The ad is the one whose platform id the same touch carries in utm_content, and only among that campaign's own ads. An order naming the campaign and none of its ads is counted in the campaign and reported on its `unassigned` line, never spread across the ads; every ad's revenue and orders plus `unassigned` add up to the campaign exactly. Orders naming no campaign are `unattributed` and still count in `totals`, which reconcile with the dashboard and analytics sales figures for the same period. Touches older than the returned lookback window, and visitors the event log classified as bots, receive no credit. Spend, impressions and clicks are the ad platform's own measurements summed per ad per day; a campaign's are its ads' summed. All money is in the smallest currency unit. A campaign with `hasLinkTags` false is Not Tracked: its revenue is unknown, not zero. `coverUrl` is the campaign's own cover, or else the creative of its ad with the most lifetime spend. `endedAt` is when an ended campaign stopped (its scheduled end once passed, otherwise the last day any of its ads reported a figure), and null otherwise.",
  })
  @ApiResponse({ status: 200 })
  async attributedRevenue(
    @Query() query: AttributedRevenueQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AttributedRevenueReport> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.revenue.byCampaign(organizationId, storeId, query.period);
  }

  @Get('campaigns/:id/performance')
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: "One campaign's performance over a period, with its ads",
    description:
      "The campaign's line from the attributed-revenue report — same credit rule, same ads, same `unassigned` residue — over 7, 30 or 90 days or its lifetime, plus the ratios its page shows. `roas` is revenue ÷ spend and null at zero spend. `conversionRate` is our orders ÷ the platform's clicks and null at zero clicks. `contributionMargin` is revenue (order totals, already net of discounts) − cost of goods − spend, and `roi` is margin ÷ spend; both are null unless every item sold on the campaign's credited orders has a cost price, and `uncostedProducts` then lists the products missing one. For a campaign with `hasLinkTags` false every revenue-derived figure is null: its revenue is unknown, not zero. Each ad carries its own `roas` and the platform's `reviewStatus`. Read entirely from stored rows; nothing calls the ad platform.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async campaignPerformance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CampaignPerformanceQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<CampaignPerformanceReport> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.revenue.forCampaign(organizationId, storeId, id, query.period);
  }
}
