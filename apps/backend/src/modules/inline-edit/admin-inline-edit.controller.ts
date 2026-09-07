import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { RbacGuard } from '../auth/guards/rbac.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PERMISSIONS, type Permission } from '../auth/constants/permissions';
import type { TenantContext } from '../../shared/tenant/tenant-context';

@Controller('admin/inline-edit')
@UseGuards(AdminAuthGuard, RbacGuard)
export class AdminInlineEditController {
  constructor(private readonly config: ConfigService) {}

  // Read-only editor bootstrap. Product writes still use AdminProductController,
  // and Slot writes AdminContentSlotController; what this reports is only what
  // the editor should offer, never a grant of anything.
  @Get()
  @RequirePermission('products.read')
  getConfig(@CurrentTenant() tenant: TenantContext) {
    const holds = (permission: Permission): boolean => {
      const roles: readonly string[] = PERMISSIONS[permission];
      return !!tenant.role && roles.includes(tenant.role);
    };
    return {
      storefrontUrl: this.config.getOrThrow<string>('STOREFRONT_URL'),
      canEditProducts: holds('products.update'),
      canEditContent: holds('content.write'),
    };
  }
}
