import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CAMPAIGN_SPEND_NOTE_LIMIT } from '../../../shared/database/schema';
import {
  ATTRIBUTION_PERIODS,
  type AttributionPeriod,
} from '../utils/attribution-period.util';

const PERIODS = ATTRIBUTION_PERIODS;

/** `YYYY-MM-DD`. Whether it names a real date is checked in the service. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class RecordCampaignSpendDto {
  @ApiProperty({
    example: '2026-09-03',
    description:
      "The calendar day the spend applies to, in the store's timezone. Recording a day that already has a figure corrects it rather than adding to it.",
  })
  @IsString()
  @Matches(DAY_PATTERN, {
    message: 'day must be a calendar date written as YYYY-MM-DD',
  })
  declare day: string;

  @ApiProperty({
    example: 12500,
    description:
      'In the smallest currency unit — 12500 is $125.00. Never a decimal, and never negative.',
  })
  @IsInt()
  @Min(0)
  declare amount: number;

  @ApiProperty({
    example: 'USD',
    description:
      "Must be the store's currency. There is no conversion anywhere in this feature, so spend in another currency is refused rather than converted.",
  })
  @IsString()
  @Length(3, 3)
  declare currency: string;

  @ApiPropertyOptional({
    example: 'Boosted the reel',
    description:
      'Optional note for the merchant. Pass an empty string to clear it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CAMPAIGN_SPEND_NOTE_LIMIT)
  declare note?: string;
}

/**
 * One total across a stretch of days, written as one row per day.
 *
 * `total` rather than `amount`, because that is what the merchant is typing: a
 * week's cost, not a day's. The division into daily rows happens in the
 * service, where the remainder rule lives.
 */
export class RecordCampaignSpendRangeDto {
  @ApiProperty({
    example: '2026-09-01',
    description: "The first day of the range, in the store's timezone.",
  })
  @IsString()
  @Matches(DAY_PATTERN, {
    message: 'startDay must be a calendar date written as YYYY-MM-DD',
  })
  declare startDay: string;

  @ApiProperty({
    example: '2026-09-07',
    description:
      'The last day of the range, included. A range that ends before it starts is refused.',
  })
  @IsString()
  @Matches(DAY_PATTERN, {
    message: 'endDay must be a calendar date written as YYYY-MM-DD',
  })
  declare endDay: string;

  @ApiProperty({
    example: 70000,
    description:
      'The total for the whole range in the smallest currency unit — not a daily figure. It is divided across the days, with the remainder added to the first day so the rows sum to exactly this number.',
  })
  @IsInt()
  @Min(0)
  declare total: number;

  @ApiProperty({
    example: 'USD',
    description: "Must be the store's currency. There is no conversion.",
  })
  @IsString()
  @Length(3, 3)
  declare currency: string;

  @ApiPropertyOptional({
    example: 'Launch week',
    description: 'Recorded against every day in the range.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CAMPAIGN_SPEND_NOTE_LIMIT)
  declare note?: string;
}

/**
 * The day is absent by design: moving a figure to another day is recording it
 * there — which corrects whatever that day already holds — and deleting the row
 * entered by mistake. So is the currency, which is the store's and frozen on
 * the row so a later currency change cannot reinterpret it.
 */
export class UpdateCampaignSpendDto {
  @ApiPropertyOptional({ example: 12500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  declare amount?: number;

  @ApiPropertyOptional({ description: 'Pass an empty string to clear it.' })
  @IsOptional()
  @IsString()
  @MaxLength(CAMPAIGN_SPEND_NOTE_LIMIT)
  declare note?: string;
}

export class ListCampaignSpendQueryDto {
  @ApiPropertyOptional({
    enum: PERIODS,
    description:
      "Defaults to 30d. The period's timestamp range is converted to calendar days in the store's timezone, and rows on those days are returned.",
  })
  @IsOptional()
  @IsEnum(PERIODS)
  declare period?: AttributionPeriod;
}
