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
  CAMPAIGN_RULE_VALUE_LIMIT,
  campaignPlatformEnum,
  campaignRuleFieldEnum,
  campaignRuleOperatorEnum,
  campaignStatusEnum,
} from '../../../shared/database/schema';
import type {
  CampaignPlatform,
  CampaignRuleField,
  CampaignRuleOperator,
  CampaignStatus,
} from '../../../shared/database/schema';

const PLATFORMS = campaignPlatformEnum.enumValues;
const STATUSES = campaignStatusEnum.enumValues;
const RULE_FIELDS = campaignRuleFieldEnum.enumValues;
const RULE_OPERATORS = campaignRuleOperatorEnum.enumValues;

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

/**
 * A rule the merchant authors to claim a UTM variant their links actually went
 * out with. There is no update DTO: a rule is three fields, so correcting one is
 * removing it and adding the right one, which also keeps the audit trail honest
 * about when a Campaign started claiming a value.
 */
export class CreateCampaignRuleDto {
  @ApiProperty({
    enum: RULE_FIELDS,
    description:
      'The attribution field to compare. utm_campaign wins over utm_source and utm_medium, which win over referrer_host, when more than one rule could match.',
  })
  @IsEnum(RULE_FIELDS)
  declare field: CampaignRuleField;

  @ApiProperty({
    enum: RULE_OPERATORS,
    description: 'equals wins over starts_with when both could match.',
  })
  @IsEnum(RULE_OPERATORS)
  declare operator: CampaignRuleOperator;

  @ApiProperty({
    example: 'summer_sale',
    description:
      'Compared with case, hyphens, underscores and spacing ignored — one rule covers summer_sale, Summer-Sale and summer sale. For referrer_host, a full URL is reduced to its host.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CAMPAIGN_RULE_VALUE_LIMIT)
  declare value: string;
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
