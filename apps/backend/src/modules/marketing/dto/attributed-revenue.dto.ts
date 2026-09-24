import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ATTRIBUTION_PERIODS,
  CAMPAIGN_PERIODS,
  type AttributionPeriod,
  type CampaignPeriod,
} from '../utils/attribution-period.util';

/**
 * A period and nothing else. There is no touch selector: credit follows the
 * latest ad click, one rule, so there is no second answer to switch to.
 */
export class AttributedRevenueQueryDto {
  @ApiProperty({ enum: ATTRIBUTION_PERIODS })
  @IsEnum(ATTRIBUTION_PERIODS)
  declare period: AttributionPeriod;
}

/** One Campaign's page: a week, a month, a quarter, or its whole life. */
export class CampaignPerformanceQueryDto {
  @ApiProperty({ enum: CAMPAIGN_PERIODS })
  @IsEnum(CAMPAIGN_PERIODS)
  declare period: CampaignPeriod;
}
