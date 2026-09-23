import { Resolver, Query, Context } from '@nestjs/graphql';
import { UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { StorefrontAuthGuard } from '../../auth/guards/storefront-auth.guard';
import type { TenantContext } from '../../../shared/tenant/tenant-context';
import { requireStoreContext } from '../../../shared/tenant/tenant.util';
import { MeasurementService } from '../services/measurement.service';
import { MeasurementSettingsModel } from '../models/measurement.model';

interface GqlContext {
  req: Request & { tenantContext?: TenantContext };
}

/**
 * The storefront's read of what it may measure, guarded by the API key that
 * already identifies the Store.
 *
 * It takes no arguments, for the same reason the content slots query takes
 * none: the Store is the key's, and there is nothing a caller could pass that
 * would widen the answer to somebody else's Pixel.
 */
@Resolver()
@UseGuards(StorefrontAuthGuard)
export class MeasurementResolver {
  constructor(private readonly measurement: MeasurementService) {}

  @Query(() => MeasurementSettingsModel, {
    description:
      'Whether this store measures its visitors, and with which Pixel. Asked ' +
      'on every page so that connecting an ad platform switches measurement ' +
      'on with no storefront deploy and no storefront configuration.',
  })
  async measurementSettings(
    @Context() ctx: GqlContext,
  ): Promise<MeasurementSettingsModel> {
    const tenant = ctx.req.tenantContext;
    if (!tenant) {
      throw new UnauthorizedException('Missing tenant context');
    }
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.measurement.forStore(organizationId, storeId);
  }
}
