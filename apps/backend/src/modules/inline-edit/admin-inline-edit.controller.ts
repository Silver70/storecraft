import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { RbacGuard } from '../auth/guards/rbac.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PERMISSIONS } from '../auth/constants/permissions';
import type { TenantContext } from '../../shared/tenant/tenant-context';

@Controller('admin/inline-edit')
@UseGuards(AdminAuthGuard, RbacGuard)
export class AdminInlineEditController {
  constructor(private readonly config: ConfigService) {}

  // Read-only editor bootstrap. Product writes still use AdminProductController.
  @Get()
  @RequirePermission('products.read')
  getConfig(@CurrentTenant() tenant: TenantContext) {
    const roles: readonly string[] = PERMISSIONS['products.update'];
    return {
      storefrontUrl: this.config.getOrThrow<string>('STOREFRONT_URL'),
      canEditProducts: !!tenant.role && roles.includes(tenant.role),
    };
  }
}
