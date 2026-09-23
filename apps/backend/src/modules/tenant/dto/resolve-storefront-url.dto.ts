import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Where a link should point. The campaign form asks for this before creating
 * anything, so that a destination off the Store's own storefront is refused on
 * the form rather than discovered once an ad has spent money.
 */
export class ResolveStorefrontUrlDto {
  @ApiProperty({
    enum: ['product', 'all_products', 'home', 'custom'],
    description: 'Which page the link points at.',
  })
  @IsIn(['product', 'all_products', 'home', 'custom'])
  declare kind: 'product' | 'all_products' | 'home' | 'custom';

  @ApiPropertyOptional({
    description: 'Product slug. Required when kind is "product".',
  })
  @ValidateIf((o: ResolveStorefrontUrlDto) => o.kind === 'product')
  @IsString()
  @MaxLength(255)
  declare slug?: string;

  @ApiPropertyOptional({
    description:
      'A path on this storefront, or a full URL on it. Required when kind is "custom".',
  })
  @ValidateIf((o: ResolveStorefrontUrlDto) => o.kind === 'custom')
  @IsString()
  @MaxLength(2048)
  declare path?: string;
}
