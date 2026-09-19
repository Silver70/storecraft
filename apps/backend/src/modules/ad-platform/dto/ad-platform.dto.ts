import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { adPlatformEnum } from '../../../shared/database/schema';
import type { AdPlatform } from '../../../shared/database/schema';

export const AD_PLATFORMS = adPlatformEnum.enumValues;

export class AdPlatformParamDto {
  @ApiProperty({ enum: AD_PLATFORMS })
  @IsIn(AD_PLATFORMS)
  platform!: AdPlatform;
}

export class BeginConnectionDto {
  /**
   * Where in the admin to return the merchant. A path, never a URL: it ends up
   * in a `Location` header on a redirect we serve, and an absolute value there
   * is an open redirect. Anything unsafe falls back to the settings page rather
   * than being rejected — a merchant midway through approving an ad account is
   * not the person to tell about a malformed path.
   */
  @ApiPropertyOptional({ example: '/admin/settings?section=ad-platforms' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  returnPath?: string;
}
