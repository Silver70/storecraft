import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CAMPAIGN_LIMITS,
  campaignPlatformEnum,
  campaignStatusEnum,
} from '../../../shared/database/schema';
import type {
  CampaignPlatform,
  CampaignStatus,
} from '../../../shared/database/schema';

const PLATFORMS = campaignPlatformEnum.enumValues;
const STATUSES = campaignStatusEnum.enumValues;

export class CreateCampaignDto {
  @ApiProperty({ example: 'Summer Sale 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CAMPAIGN_LIMITS.name)
  declare name: string;

  @ApiProperty({ enum: PLATFORMS })
  @IsEnum(PLATFORMS)
  declare platform: CampaignPlatform;

  @ApiPropertyOptional({
    description:
      "The campaign's id on the ad platform, for reconciling with it later.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(CAMPAIGN_LIMITS.externalId)
  declare externalId?: string;
}

/**
 * The tag is absent by design — it is assigned at creation and never changes, so
 * that links already live in an ad platform keep matching. Status is absent for
 * the same reason archiving is its own endpoint: it is an action, not a field.
 */
export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CAMPAIGN_LIMITS.name)
  declare name?: string;

  @ApiPropertyOptional({ enum: PLATFORMS })
  @IsOptional()
  @IsEnum(PLATFORMS)
  declare platform?: CampaignPlatform;

  @ApiPropertyOptional({ description: 'Pass an empty string to clear it.' })
  @IsOptional()
  @IsString()
  @MaxLength(CAMPAIGN_LIMITS.externalId)
  declare externalId?: string;
}

export class ListCampaignsQueryDto {
  @ApiPropertyOptional({
    enum: [...STATUSES, 'all'],
    description: 'Defaults to active — archived campaigns are kept out of it.',
  })
  @IsOptional()
  @IsEnum([...STATUSES, 'all'])
  declare status?: CampaignStatus | 'all';
}
