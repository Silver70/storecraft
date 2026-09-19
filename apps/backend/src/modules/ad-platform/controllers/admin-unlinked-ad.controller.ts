import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  UnlinkedAdService,
  type ClaimResult,
  type UnlinkedAdView,
} from '../services/unlinked-ad.service';
import {
  ClaimUnlinkedAdDto,
  ListUnlinkedAdsQueryDto,
} from '../dto/unlinked-ad.dto';

/**
 * The ads a platform is spending on that nothing in this store claims — and the
 * four things a merchant can do about one.
 *
 * Reading is `ad_platforms.read`, because it is a read of what the sync found.
 * Deciding is `campaigns.write`, because it is not: a claim creates an Ad under
 * a Campaign and writes the platform's id onto it, which is the same authority
 * as creating that Ad by hand, and no new permission was invented for a
 * different route to the same change.
 */
@ApiTags('Ad platforms')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/ad-platforms/unlinked-ads')
export class AdminUnlinkedAdController {
  constructor(private readonly unlinked: UnlinkedAdService) {}

  /**
   * How many are waiting.
   *
   * Its own endpoint, and cheap, so the number can sit beside the campaign grid
   * where the merchant will see it without going looking. Nobody opens a review
   * list they do not know has anything in it, and what is in this one is money
   * leaving their account that nothing here is counting.
   *
   * Declared before `:id` so a literal path is never read as an id.
   */
  @Get('count')
  @RequirePermission('ad_platforms.read')
  @ApiOperation({
    summary: 'How many unlinked ads are waiting on this store',
    description:
      'The waiting count, plus how many have been claimed and dismissed. Meant to be shown beside the campaign grid rather than read on its own page.',
  })
  @ApiResponse({ status: 200 })
  async counts(
    @CurrentTenant() tenant: TenantContext,
  ): Promise<{ pending: number; claimed: number; dismissed: number }> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.unlinked.counts(organizationId, storeId);
  }

  @Get()
  @RequirePermission('ad_platforms.read')
  @ApiOperation({
    summary: 'Ads the platform is spending on that nothing here claims',
    description:
      'Each carries its platform id, name, creative, flight dates and what it has spent to date in the ad account’s currency. Waiting ones by default; pass state=dismissed, state=claimed or state=all for the rest. No ad here has been turned into an Ad — that is the merchant’s decision and nothing else makes it.',
  })
  @ApiResponse({ status: 200 })
  async list(
    @Query() query: ListUnlinkedAdsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<UnlinkedAdView[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    const state = query.state ?? 'pending';
    return this.unlinked.list(
      organizationId,
      storeId,
      state === 'all' ? undefined : state,
    );
  }

  @Post(':id/claim')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Claim an unlinked ad onto a campaign or an existing ad',
    description:
      "Creates an Ad under the campaign, or records the platform's id against an Ad that already exists here. Its reported figures — including everything backfilled before the claim — attach to that Ad, so claiming never starts an ad's spend from zero. The response carries the Ad's tagged link, because pasting it into the platform is what makes the ad measurable.",
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 404,
    description: 'Unknown unlinked ad, campaign or ad',
  })
  @ApiResponse({
    status: 409,
    description:
      'Already claimed, or another ad in this store has claimed this platform ad',
  })
  async claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClaimUnlinkedAdDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ClaimResult> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.unlinked.claim(organizationId, storeId, id, dto);
  }

  @Post(':id/dismiss')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Dismiss an unlinked ad',
    description:
      'It stops asking to be dealt with and does not come back on the next sync. Its reported figures are untouched and stay readable — declining to attribute the money is not declining to know about it. Reversible.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  @ApiResponse({
    status: 409,
    description: 'Already claimed or already dismissed',
  })
  async dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<UnlinkedAdView> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.unlinked.dismiss(organizationId, storeId, id);
  }

  @Post(':id/restore')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Put a dismissed ad back in the list',
    description: 'A misclick on dismiss is not permanent.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Not dismissed' })
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<UnlinkedAdView> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.unlinked.restore(organizationId, storeId, id);
  }

  @Post(':id/unlink')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary: 'Undo a claim',
    description:
      "Takes the platform's id off the ad it was claimed onto and puts the unlinked ad back in the list. The Ad itself is kept, because it may already have earned revenue through its own tag. No reported figure is deleted: reclaiming brings all of it back.",
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Not claimed' })
  async unlink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<UnlinkedAdView> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.unlinked.unlink(organizationId, storeId, id);
  }
}
