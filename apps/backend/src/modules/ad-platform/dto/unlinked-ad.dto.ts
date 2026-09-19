import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { unlinkedAdStateEnum } from '../../../shared/database/schema';
import type { UnlinkedAdState } from '../../../shared/database/schema';
import { UNLINKED_AD_LIMITS } from '../../../shared/database/schema';

export const UNLINKED_AD_STATES = unlinkedAdStateEnum.enumValues;

/**
 * Which decisions to list. `pending` by default, because the list is a prompt
 * and not an archive — what the merchant opens it for is the ads still asking a
 * question.
 */
export class ListUnlinkedAdsQueryDto {
  @ApiPropertyOptional({ enum: [...UNLINKED_AD_STATES, 'all'] })
  @IsOptional()
  @IsIn([...UNLINKED_AD_STATES, 'all'])
  state?: UnlinkedAdState | 'all';
}

export class ClaimUnlinkedAdDto {
  /**
   * The Campaign the ad belongs to — required on both paths.
   *
   * On the `adId` path it is what scopes the lookup rather than a second way of
   * saying the same thing: an Ad has no meaning outside its Campaign (ADR-0004)
   * and is addressed beneath it everywhere else in this API.
   */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  campaignId!: string;

  /**
   * An Ad that already exists here. Omit it to create one under the Campaign.
   *
   * Claiming onto an existing Ad records the platform's id against it and
   * creates nothing — the merchant already built this creative here and is
   * saying it is the same one running there.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  adId?: string;

  /** What to call a newly created Ad. Defaults to what the platform calls it. */
  @ApiPropertyOptional({ example: 'Summer reel' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(UNLINKED_AD_LIMITS.name)
  name?: string;
}
