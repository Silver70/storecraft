import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AD_LIMITS, campaignStatusEnum } from '../../../shared/database/schema';
import type { AdStatus } from '../../../shared/database/schema';

const STATUSES = campaignStatusEnum.enumValues;

const FLIGHT_DATE_DESCRIPTION =
  'Optional. Either date may be set without the other — a merchant often knows when a test started and not when it will stop. Send null to clear it.';

export class CreateAdDto {
  @ApiProperty({ example: 'Beach video A' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(AD_LIMITS.name)
  declare name: string;

  @ApiPropertyOptional({
    description:
      "The ad's id on the ad platform, for reconciling with it later.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(AD_LIMITS.externalId)
  declare externalId?: string;

  @ApiPropertyOptional({ description: FLIGHT_DATE_DESCRIPTION })
  @IsOptional()
  @IsDateString()
  declare startsAt?: string | null;

  @ApiPropertyOptional({ description: FLIGHT_DATE_DESCRIPTION })
  @IsOptional()
  @IsDateString()
  declare endsAt?: string | null;
}

/**
 * The tag is absent by design — it is assigned at creation and never changes, so
 * that a link already running in an ad platform keeps matching. Status is absent
 * for the same reason archiving is its own endpoint: it is an action, not a
 * field.
 */
export class UpdateAdDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AD_LIMITS.name)
  declare name?: string;

  @ApiPropertyOptional({ description: 'Pass an empty string to clear it.' })
  @IsOptional()
  @IsString()
  @MaxLength(AD_LIMITS.externalId)
  declare externalId?: string;

  @ApiPropertyOptional({ description: FLIGHT_DATE_DESCRIPTION })
  @IsOptional()
  @IsDateString()
  declare startsAt?: string | null;

  @ApiPropertyOptional({ description: FLIGHT_DATE_DESCRIPTION })
  @IsOptional()
  @IsDateString()
  declare endsAt?: string | null;
}

export class ListAdsQueryDto {
  @ApiPropertyOptional({
    enum: [...STATUSES, 'all'],
    description: 'Defaults to active — archived ads are kept out of it.',
  })
  @IsOptional()
  @IsEnum([...STATUSES, 'all'])
  declare status?: AdStatus | 'all';
}
