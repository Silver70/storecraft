import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DRAFT_LIMITS } from '../utils/campaign-draft.util';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What Edit can change on a campaign, and nothing else: the name, the daily
 * budget and the end date. Audience and goal are not here because changing
 * them resets what the platform has learned. Each field is optional, and a
 * field left out is left alone.
 */
export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DRAFT_LIMITS.name)
  name?: string;

  @ApiPropertyOptional({
    description: 'Per day, in minor units of the Store currency',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyBudget?: number;

  @ApiPropertyOptional({
    example: '2026-10-31',
    nullable: true,
    description:
      'The last day it runs, in the Store timezone. Null runs it until it is paused.',
  })
  @ValidateIf((dto: UpdateCampaignDto) => dto.endDate !== null)
  @IsOptional()
  @Matches(DAY, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string | null;
}

export const DELIVERY_SWITCHES = ['active', 'paused'] as const;

/** Pause or resume. */
export class SetDeliveryDto {
  @ApiProperty({ enum: DELIVERY_SWITCHES })
  @IsIn(DELIVERY_SWITCHES)
  status!: (typeof DELIVERY_SWITCHES)[number];
}

/**
 * The picture a campaign is recognised by: one of its own ads' creatives, or
 * an image this Store uploaded. Exactly one of the two.
 */
export class SetCoverDto {
  @ApiPropertyOptional({ description: 'An ad of this campaign' })
  @ValidateIf((dto: SetCoverDto) => dto.uploadUrl === undefined)
  @IsUUID()
  adId?: string;

  @ApiPropertyOptional({
    description: 'What POST /admin/campaigns/creatives answered',
  })
  @ValidateIf((dto: SetCoverDto) => dto.adId === undefined)
  @IsString()
  @MaxLength(2048)
  uploadUrl?: string;
}
