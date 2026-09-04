import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CAMPAIGN_RULE_VALUE_LIMIT,
  campaignRuleFieldEnum,
  campaignRuleOperatorEnum,
} from '../../../shared/database/schema';
import type {
  CampaignRuleField,
  CampaignRuleOperator,
} from '../../../shared/database/schema';
import type { AttributionTouch } from '../services/attributed-revenue.service';
import {
  ATTRIBUTION_PERIODS,
  type AttributionPeriod,
} from '../utils/attribution-period.util';

const RULE_FIELDS = campaignRuleFieldEnum.enumValues;
const RULE_OPERATORS = campaignRuleOperatorEnum.enumValues;
const TOUCHES = ['first', 'last'] as const;

/**
 * A candidate rule, in the same three fields `CreateCampaignRuleDto` takes plus
 * the period to try it against. Deliberately the same three, so what is
 * previewed is what is posted — a preview whose input differed from the create
 * body would be a preview of a different rule.
 */
export class PreviewCampaignRuleQueryDto {
  @ApiProperty({ enum: RULE_FIELDS })
  @IsEnum(RULE_FIELDS)
  declare field: CampaignRuleField;

  @ApiProperty({ enum: RULE_OPERATORS })
  @IsEnum(RULE_OPERATORS)
  declare operator: CampaignRuleOperator;

  @ApiProperty({
    example: 'summer_sale',
    description:
      'Compared with case, hyphens, underscores and spacing ignored. For referrer_host, a full URL is reduced to its host — the response echoes back what would actually be stored and compared.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CAMPAIGN_RULE_VALUE_LIMIT)
  declare value: string;

  @ApiPropertyOptional({
    enum: ATTRIBUTION_PERIODS,
    description:
      'Which orders to try the rule against. Defaults to 30d, the same window the attributed-revenue report opens on.',
  })
  @IsOptional()
  @IsEnum(ATTRIBUTION_PERIODS)
  declare period?: AttributionPeriod;

  @ApiPropertyOptional({
    enum: TOUCHES,
    description:
      'Which touch to resolve. Defaults to last, matching the revenue report, so the two answers line up.',
  })
  @IsOptional()
  @IsEnum(TOUCHES)
  declare touch?: AttributionTouch;
}
