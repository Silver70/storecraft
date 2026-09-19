import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
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

/** `YYYY-MM-DD`. Whether it names a real date is checked in the service. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which Reported Figures to read back.
 *
 * Every field is optional, because the useful default is the last thirty days
 * of everything — a merchant opening the page has not yet decided what they are
 * looking for. The range is resolved in the store's timezone, not the server's.
 */
export class ReportedFigureQueryDto {
  @ApiPropertyOptional({ example: '2026-08-21' })
  @IsOptional()
  @IsString()
  @Matches(DAY_PATTERN, {
    message: 'from must be a calendar date written as YYYY-MM-DD',
  })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-19' })
  @IsOptional()
  @IsString()
  @Matches(DAY_PATTERN, {
    message: 'to must be a calendar date written as YYYY-MM-DD',
  })
  to?: string;

  @ApiPropertyOptional({ enum: AD_PLATFORMS })
  @IsOptional()
  @IsIn(AD_PLATFORMS)
  platform?: AdPlatform;
}
