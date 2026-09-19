import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdminAuthService } from '../services/admin-auth.service';
import { ApiKeyService } from '../services/api-key.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { RbacGuard } from '../guards/rbac.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { CurrentTenant } from '../decorators/current-tenant.decorator';
import type { TenantContext } from '../../../shared/tenant/tenant-context';
import { requireStoreContext } from '../../../shared/tenant/tenant.util';
import {
  AdminRegisterDto,
  AdminLoginDto,
  AdminRefreshDto,
} from '../dto/admin-auth.dto';

class CreateApiKeyDto {
  @ApiProperty({ description: 'Display name for this API key' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  declare name: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  // ─── Admin auth (self-hosted, replaces WorkOS) ──────────────────────────────

  @Post('admin/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Self-serve signup: create an admin user, org, and super_admin role',
  })
  @ApiResponse({ status: 201 })
  async register(@Body() dto: AdminRegisterDto) {
    return this.adminAuth.register(dto.email, dto.password, dto.orgName);
  }

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate an admin user with email + password' })
  @ApiResponse({ status: 200 })
  async login(@Body() dto: AdminLoginDto) {
    return this.adminAuth.login(dto.email, dto.password);
  }

  @Post('admin/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new access token',
  })
  @ApiResponse({ status: 200 })
  async refresh(@Body() dto: AdminRefreshDto) {
    return this.adminAuth.refresh(dto.refreshToken);
  }

  @Post('admin/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiResponse({ status: 204 })
  async logout(@Body() dto: AdminRefreshDto): Promise<void> {
    await this.adminAuth.logout(dto.refreshToken);
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin user info + memberships' })
  async me(@CurrentTenant() tenant: TenantContext) {
    const profile = await this.adminAuth.getProfile(tenant.userId!);
    return {
      userId: profile.id,
      email: profile.email,
      name: profile.name,
      organizationId: tenant.organizationId,
      role: tenant.role,
      memberships: profile.memberships,
    };
  }

  // ─── API Key management ────────────────────────────────────────────────────

  @Get('admin/api-keys')
  @UseGuards(AdminAuthGuard, RbacGuard)
  @RequirePermission('settings.write')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List API keys for the organization' })
  @ApiResponse({ status: 200 })
  async listApiKeys(@CurrentTenant() tenant: TenantContext) {
    return this.apiKeyService.listByOrg(tenant.organizationId);
  }

  @Post('admin/api-keys')
  @UseGuards(AdminAuthGuard, RbacGuard)
  @RequirePermission('settings.write')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Generate a new API key — raw key is returned once and never stored',
  })
  @ApiResponse({ status: 201 })
  async generateApiKey(
    @Body() dto: CreateApiKeyDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const { organizationId, storeId } = requireStoreContext(tenant);
    return this.apiKeyService.generate(
      organizationId,
      storeId,
      dto.name,
      tenant.userId,
    );
  }

  @Delete('admin/api-keys/:id')
  @UseGuards(AdminAuthGuard, RbacGuard)
  @RequirePermission('settings.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 204 })
  async revokeApiKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<void> {
    await this.apiKeyService.revoke(id, tenant.organizationId);
  }
}
