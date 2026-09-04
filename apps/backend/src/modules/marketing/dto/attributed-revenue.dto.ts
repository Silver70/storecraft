import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AttributionTouch } from '../services/attributed-revenue.service';
import {
  ATTRIBUTION_PERIODS,
  type AttributionPeriod,
} from '../utils/attribution-period.util';

const PERIODS = ATTRIBUTION_PERIODS;
const TOUCHES = ['first', 'last'] as const;

export class AttributedRevenueQueryDto {
  @ApiProperty({ enum: PERIODS })
  @IsEnum(PERIODS)
  declare period: AttributionPeriod;

  @ApiPropertyOptional({
    enum: TOUCHES,
    description:
      'Which touch to credit. Defaults to last — the ad that closed the sale. Switching is a re-read, not a migration: both touches are stored on every order.',
  })
  @IsOptional()
  @IsEnum(TOUCHES)
  declare touch?: AttributionTouch;
}
