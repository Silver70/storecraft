import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DEFAULT_PRODUCT_PATH_PATTERN } from '../../../shared/utils/storefront-url.util';

export class CreateStoreDto {
  @ApiProperty({ description: 'Display name of the store' })
  @IsString()
  @MaxLength(255)
  declare name: string;

  @ApiPropertyOptional({
    description:
      'URL-safe slug, unique within the organization. Auto-generated if omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase, alphanumeric, with optional hyphen separators',
  })
  @MaxLength(255)
  declare slug?: string;

  @ApiPropertyOptional({
    description: 'ISO-4217 currency code',
    default: 'USD',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  declare currency?: string;

  @ApiPropertyOptional({ description: 'IANA timezone string', default: 'UTC' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare timezone?: string;

  @ApiPropertyOptional({
    description:
      'Absolute address this store’s storefront is served at, with no query string or fragment. Null until the merchant sets it; ad destinations cannot be built without it.',
    example: 'https://shop.example.com',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  declare storefrontUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Shape of the storefront’s product page paths. Must contain the {slug} placeholder.',
    default: DEFAULT_PRODUCT_PATH_PATTERN,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  declare productPathPattern?: string;

  @ApiPropertyOptional({
    description:
      'Whether the storefront must ask a visitor before it measures anything. Off by default, so a store selling where consent is not required shows no banner.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  declare requiresMeasurementConsent?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  declare isActive?: boolean;
}

export class UpdateStoreDto extends PartialType(CreateStoreDto) {}
