import { Resolver, Query, Context } from '@nestjs/graphql';
import { UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { StorefrontAuthGuard } from '../../auth/guards/storefront-auth.guard';
import type { TenantContext } from '../../../shared/tenant/tenant-context';
import { requireStoreContext } from '../../../shared/tenant/tenant.util';
import { ContentSlotService } from '../services/content-slot.service';
import { ContentSlotModel } from '../models/content-slot.model';

interface GqlContext {
  req: Request & { tenantContext?: TenantContext };
}

/**
 * The storefront's read of its own Content Slots, guarded by the API key that
 * already identifies the Store.
 *
 * It takes **no arguments**. Published values only is not a default here, it
 * is the whole surface: there is nothing a caller can pass that would widen
 * it, because the failure this guards against — a merchant's unfinished words
 * reaching a shopper — cannot be undone once it has happened.
 */
@Resolver()
@UseGuards(StorefrontAuthGuard)
export class ContentSlotResolver {
  constructor(private readonly slots: ContentSlotService) {}

  @Query(() => [ContentSlotModel], {
    description:
      "The store's published content slots. Drafts are never returned.",
  })
  async contentSlots(@Context() ctx: GqlContext): Promise<ContentSlotModel[]> {
    const tenant = ctx.req.tenantContext;
    if (!tenant) {
      throw new UnauthorizedException('Missing tenant context');
    }
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.slots.listPublished(organizationId, storeId);
  }
}
