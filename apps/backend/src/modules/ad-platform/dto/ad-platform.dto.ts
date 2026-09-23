import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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

/**
 * Which ad account this Store reports against.
 *
 * The id is the platform's, as the platform spells it, and it is checked
 * against what the connection can actually reach before anything is recorded —
 * a merchant cannot name an account they were never granted, and the currency
 * rule is applied here too rather than only in the picker.
 */
export class SelectAdAccountDto {
  @ApiProperty({ example: 'act_1234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  accountId!: string;
}
