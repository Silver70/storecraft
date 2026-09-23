import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ATTRIBUTION_PERIODS,
  type AttributionPeriod,
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
