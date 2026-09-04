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
  type MarketingSummary,
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
    summary:
      'Attributed revenue, spend, ROAS and contribution margin by campaign',
    description:
      "Resolves each order in the period to a campaign by running the store's matching rules against the touch it froze at checkout, so a campaign created after its ads ran still claims them and a corrected rule repairs history. Unattributed is its own bucket, is never spread across campaigns, and carries no spend, ROAS or margin. Touches older than the returned lookback window, and visitors the event log classified as bots, receive no credit but still count in the totals — which reconcile with the dashboard and analytics sales figures for the same period. Revenue is in the smallest currency unit and is unchanged by the cost figures. Each line also carries the spend recorded for the period and the ROAS between the two: a ratio to two decimal places, not a money value, and null rather than zero or infinity when nothing was spent. A campaign appears if it is active, earned revenue in the period, or recorded spend in the period — an archived campaign quietly burning budget is the row this report exists to show. Spend is recorded per calendar day in the store's timezone while revenue is timestamped, so a partial current day compares a full day of cost against part of a day of revenue. Two revenue bases are returned and they are different numbers: `revenue` is the order total (tax and shipping in, discounts already netted out) and is what ROAS divides, while `goodsRevenue` is line-item totals before discount and is what `contributionMargin` — goods revenue minus discounts minus cost of goods minus spend — is built on. Cost price is nullable on variants, so `costCoveragePct` reports the share of goods revenue that had a known cost behind it, on the same convention as the analytics profit report, and `contributionMargin` is null rather than fictional when goods were sold and none of them were costed. A negative margin is returned as a negative number and never clamped.",
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

  /**
   * The same period as `attributed-revenue`, reduced to what fits on a card.
   *
   * It exists so the admin dashboard can show what was spent without the
   * dashboard module learning anything about Campaigns. A report module never
   * depends on another report module here — analytics owns its own period
   * helper rather than importing the dashboard's, and marketing owns its own
   * rather than importing analytics' — so marketing publishes this read and the
   * dashboard *page* composes the card from a second request. The coupling
   * lives in the frontend, where it costs one fetch and no dependency.
   *
   * Same permission as the full report, because it is the same data: a role
   * that may not see what Campaigns cost may not see the total either.
   */
  @Get('summary')
  @RequirePermission('campaigns.read')
  @ApiOperation({
    summary: 'Blended spend, attributed revenue and ROAS for a period',
    description:
      "The dashboard card behind the campaign performance report. Every figure is read off that report rather than computed a second way, so the card and the report cannot disagree about the same period — the lookback window, the matching, and the calendar days spend is counted over are all the report's. `spend` and `revenue` are in the smallest currency unit; `roas` is a ratio to two decimal places and is null rather than zero when nothing was spent. `unattributedPct` is the share of realized revenue no campaign explains, returned beside the ratio because it is the caveat on it: a blended ROAS over a third of a store's revenue is not an account-wide verdict. `spendEverRecorded` tells a store that has never recorded a cost apart from one that simply spent nothing this period, which a zero cannot.",
  })
  @ApiResponse({ status: 200 })
  async summary(
    @Query() query: AttributedRevenueQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MarketingSummary> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.revenue.summary(
      organizationId,
      storeId,
      query.period,
      query.touch ?? 'last',
    );
  }
}
