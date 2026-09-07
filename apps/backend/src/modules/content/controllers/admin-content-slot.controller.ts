import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
import type { ContentSlot } from '../../../shared/database/schema';
import { ContentSlotService } from '../services/content-slot.service';
import {
  ContentSlotKeyParamDto,
  SaveContentSlotDraftDto,
} from '../dto/content-slot.dto';

/**
 * Content Slots for the active Store. Drafting and publishing are separate
 * endpoints because they are separate decisions: a merchant writes next week's
 * promotion whenever they like, and it goes live when they say so.
 *
 * There is no delete. A Slot exists because the storefront renders a region at
 * that key; removing the row would not remove the region, it would only lose
 * what the merchant put in it.
 */
@ApiTags('Content')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/content/slots')
export class AdminContentSlotController {
  constructor(private readonly slots: ContentSlotService) {}

  @Get()
  @RequirePermission('content.read')
  @ApiOperation({
    summary: 'List the content slots of the active store',
    description:
      'Both the published value and the draft, so the editor can show the merchant what they are working on and what shoppers are seeing.',
  })
  @ApiResponse({ status: 200 })
  async list(@CurrentTenant() tenant: TenantContext): Promise<ContentSlot[]> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.slots.list(organizationId, storeId);
  }

  @Put(':key/draft')
  @RequirePermission('content.write')
  @ApiOperation({
    summary: "Save a slot's draft",
    description:
      'Creates the slot the first time a declared region is edited. The published value is untouched, so shoppers keep seeing the live copy.',
  })
  @ApiResponse({ status: 200 })
  async saveDraft(
    @Param() params: ContentSlotKeyParamDto,
    @Body() body: SaveContentSlotDraftDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ContentSlot> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.slots.saveDraft(params.key, body, organizationId, storeId);
  }

  @Post(':key/publish')
  @RequirePermission('content.write')
  @ApiOperation({
    summary: "Publish a slot's draft",
    description:
      'Makes the drafted value the one shoppers see. Publishing is its own action so that going live is a decision, not a side effect of typing.',
  })
  @ApiResponse({ status: 201 })
  async publish(
    @Param() params: ContentSlotKeyParamDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ContentSlot> {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.slots.publish(params.key, organizationId, storeId);
  }
}
