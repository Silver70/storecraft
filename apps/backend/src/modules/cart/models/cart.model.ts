import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { CartAttributionType } from './attribution.model';

@ObjectType()
export class CartItemType {
  @Field(() => ID)
  declare id: string;

  @Field(() => ID)
  declare cartId: string;

  @Field(() => ID)
  declare variantId: string;

  @Field(() => Int, { description: 'Quantity in cart' })
  declare quantity: number;

  @Field(() => Int, { description: 'Unit price in cents at time of adding' })
  declare unitPrice: number;

  @Field(() => Int, {
    description: 'Line total in cents (quantity × unitPrice)',
  })
  declare totalPrice: number;

  @Field(() => String, { description: 'Product display name' })
  declare productName: string;

  @Field(() => String, {
    description: 'Product slug for linking back to the PDP',
  })
  declare productSlug: string;

  @Field(() => String, { nullable: true, description: 'Variant display name' })
  declare variantName?: string | null;

  @Field(() => String, { description: 'Variant SKU' })
  declare sku: string;

  @Field(() => String, {
    nullable: true,
    description: 'Primary product image URL',
  })
  declare imageUrl?: string | null;

  @Field()
  declare createdAt: Date;

  @Field()
  declare updatedAt: Date;
}

@ObjectType()
export class CartType {
  @Field(() => ID)
  declare id: string;

  @Field(() => ID)
  declare organizationId: string;

  @Field(() => ID, { nullable: true })
  declare customerId?: string | null;

  @Field(() => String, { description: 'active | converted | abandoned' })
  declare status: string;

  @Field(() => String, { nullable: true })
  declare couponCode?: string | null;

  @Field(() => Int, { description: 'Subtotal before discounts, in cents' })
  declare subtotal: number;

  @Field(() => Int, { description: 'Total discount amount in cents' })
  declare discountAmount: number;

  @Field(() => Int, { description: 'Tax amount in cents (0 until checkout)' })
  declare taxAmount: number;

  @Field(() => Int, {
    description: 'Shipping amount in cents (0 until checkout)',
  })
  declare shippingAmount: number;

  @Field(() => Int, { description: 'Grand total in cents' })
  declare total: number;

  @Field(() => String, { description: 'ISO 4217 currency code' })
  declare currency: string;

  @Field(() => [CartItemType], { description: 'Line items in the cart' })
  declare items: CartItemType[];

  @Field(() => CartAttributionType, {
    description:
      'Where this cart’s visitor came from. Copied onto the order at ' +
      'checkout and frozen there.',
  })
  declare attribution: CartAttributionType;

  @Field(() => Date, { nullable: true })
  declare expiresAt?: Date | null;

  @Field()
  declare createdAt: Date;

  @Field()
  declare updatedAt: Date;
}
