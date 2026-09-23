import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { StoreService } from '../services/store.service';
import { CreateStoreDto, UpdateStoreDto } from '../dto/create-store.dto';
import { ApiKeyService } from '../../auth/services/api-key.service';
import { CreateApiKeyDto } from '../dto/create-api-key.dto';
import { ResolveStorefrontUrlDto } from '../dto/resolve-storefront-url.dto';
import type { StorefrontDestination } from '../../../shared/utils/storefront-url.util';

/** The wire shape, narrowed to the union the resolver reads. */
function toDestination(dto: ResolveStorefrontUrlDto): StorefrontDestination {
  switch (dto.kind) {
    case 'product':
      return { kind: 'product', slug: dto.slug ?? '' };
    case 'custom':
      return { kind: 'custom', path: dto.path ?? '' };
    case 'all_products':
      return { kind: 'all_products' };
    case 'home':
      return { kind: 'home' };
  }
}

@ApiTags('Stores')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, RbacGuard)
@Controller('admin/stores')
export class AdminStoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  @Get()
  @RequirePermission('settings.write')
  @ApiOperation({ summary: 'List all stores in the organization' })
  list(@CurrentTenant() tenant: TenantContext) {
    return this.storeService.list(tenant.organizationId);
  }

  @Post()
  @RequirePermission('settings.write')
  @ApiOperation({ summary: 'Create a new store' })
  create(@Body() dto: CreateStoreDto, @CurrentTenant() tenant: TenantContext) {
    return this.storeService.create(tenant.organizationId, dto);
  }

  @Get(':id')
  @RequirePermission('settings.write')
  @ApiOperation({ summary: 'Get a store by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const store = await this.storeService.findById(id, tenant.organizationId);
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  @Patch(':id')
  @RequirePermission('settings.write')
  @ApiOperation({ summary: 'Update a store' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.storeService.update(id, tenant.organizationId, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a store' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.storeService.softDelete(id, tenant.organizationId);
  }

  // ─── Storefront links ─────────────────────────────────────────────────────

  @Get(':id/storefront')
  @RequirePermission('campaigns.write')
  @ApiOperation({
    summary:
      'Read where this store’s storefront lives, and whether links can be built yet',
  })
  storefront(
    @Param('id', ParseUUIDPipe) storeId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.storeService.storefrontSettings(storeId, tenant.organizationId);
  }

  @Post(':id/storefront/resolve')
  @RequirePermission('campaigns.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a destination to its full URL on this store’s storefront',
  })
  @ApiResponse({
    status: 400,
    description:
      'The storefront URL is unset, or the destination is not on this store’s storefront.',
  })
  async resolveStorefrontUrl(
    @Param('id', ParseUUIDPipe) storeId: string,
    @Body() dto: ResolveStorefrontUrlDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const url = await this.storeService.resolveStorefrontUrl(
      storeId,
      tenant.organizationId,
      toDestination(dto),
    );
    return { url };
  }

  // ─── API Keys (store-scoped) ──────────────────────────────────────────────

  @Get(':id/api-keys')
  @RequirePermission('api_keys.manage')
  @ApiOperation({ summary: 'List API keys for a store' })
  async listApiKeys(
    @Param('id', ParseUUIDPipe) storeId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    await this.storeService.assertExists(storeId, tenant.organizationId);
    return this.apiKeyService.listByStore(storeId);
  }

  @Post(':id/api-keys')
  @RequirePermission('api_keys.manage')
  @ApiOperation({ summary: 'Generate a new API key for a store' })
  @ApiResponse({
    status: 201,
    description: 'Raw key returned once — store securely.',
  })
  async createApiKey(
    @Param('id', ParseUUIDPipe) storeId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    await this.storeService.assertExists(storeId, tenant.organizationId);
    return this.apiKeyService.generate(
      tenant.organizationId,
      storeId,
      dto.name,
      tenant.userId,
    );
  }
}
