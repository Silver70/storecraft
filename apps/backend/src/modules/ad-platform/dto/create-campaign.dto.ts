import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import {
  CALLS_TO_ACTION,
  type CallToAction,
} from '../interfaces/ad-platform-provider.interface';
import { DRAFT_LIMITS, MAX_ADS } from '../utils/campaign-draft.util';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const MEDIA_SOURCES = ['product', 'upload'] as const;
export const DESTINATIONS = [
  'product',
  'all_products',
  'home',
  'custom',
] as const;

/**
 * One ad on the form.
 *
 * Media and destination are both references rather than URLs. The picture is
 * one of this Store's product images or a file uploaded to this Store's own
 * storage. The link is one of its products, one of its storefront's pages, or
 * a path on it. The server turns each into a URL, so an ad cannot show someone
 * else's image or send a click anywhere the capture script cannot read it.
 */
export class CampaignAdDto {
  @ApiProperty({ enum: MEDIA_SOURCES })
  @IsIn(MEDIA_SOURCES)
  mediaSource!: (typeof MEDIA_SOURCES)[number];

  @ApiPropertyOptional({
    description: 'A product image, when mediaSource is product',
  })
  @ValidateIf((ad: CampaignAdDto) => ad.mediaSource === 'product')
  @IsUUID()
  productMediaId?: string;

  @ApiPropertyOptional({
    description:
      'What POST /admin/campaigns/creatives answered, when mediaSource is upload',
  })
  @ValidateIf((ad: CampaignAdDto) => ad.mediaSource === 'upload')
  @IsString()
  @MaxLength(2048)
  uploadUrl?: string;

  @ApiProperty({ description: 'The main text above the picture' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(DRAFT_LIMITS.primaryText)
  primaryText!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DRAFT_LIMITS.headline)
  headline!: string;

  @ApiPropertyOptional({ enum: CALLS_TO_ACTION, default: 'shop_now' })
  @IsOptional()
  @IsIn(CALLS_TO_ACTION)
  callToAction?: CallToAction;

  @ApiProperty({ enum: DESTINATIONS })
  @IsIn(DESTINATIONS)
  destination!: (typeof DESTINATIONS)[number];

  @ApiPropertyOptional({ description: 'When destination is product' })
  @ValidateIf((ad: CampaignAdDto) => ad.destination === 'product')
  @IsUUID()
  destinationProductId?: string;

  @ApiPropertyOptional({
    description: 'A path on the storefront, when destination is custom',
  })
  @ValidateIf((ad: CampaignAdDto) => ad.destination === 'custom')
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  destinationPath?: string;
}

/**
 * The create form. Nothing on it chooses a goal, a placement, a bid or an ad
 * set, because none of those is a choice here.
 */
export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DRAFT_LIMITS.name)
  name!: string;

  @ApiProperty({ description: 'Per day, in minor units of the Store currency' })
  @IsInt()
  @Min(1)
  dailyBudget!: number;

  @ApiProperty({ example: '2026-10-01', description: 'In the Store timezone' })
  @Matches(DAY, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-10-31', nullable: true })
  @IsOptional()
  @Matches(DAY, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string | null;

  @ApiProperty({ example: ['US', 'CA'] })
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  countries!: string[];

  @ApiProperty({ example: 18 })
  @IsInt()
  ageMin!: number;

  @ApiProperty({ example: 65 })
  @IsInt()
  ageMax!: number;

  @ApiProperty({ enum: ['active', 'paused'] })
  @IsIn(['active', 'paused'])
  launch!: 'active' | 'paused';

  @ApiProperty({ type: [CampaignAdDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ADS)
  @ValidateNested({ each: true })
  @Type(() => CampaignAdDto)
  ads!: CampaignAdDto[];
}
