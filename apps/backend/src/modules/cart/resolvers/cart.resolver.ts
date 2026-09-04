import {
  Resolver,
  Mutation,
  Query,
  Args,
  ID,
  Int,
  Context,
} from '@nestjs/graphql';
import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { StorefrontAuthGuard } from '../../auth/guards/storefront-auth.guard';
import { CartService } from '../services/cart.service';
import { CheckoutService } from '../services/checkout.service';
import { CartType, CartItemType } from '../models/cart.model';
import { CheckoutResultType } from '../models/checkout.model';
import { CheckoutInput } from '../models/checkout-input.model';
import {
  CartAttributionInput,
  toCartAttributionType,
} from '../models/attribution.model';
import type { CartWithItems } from '../repositories/cart.repository';
import { pickAttribution } from '../../../shared/attribution/attribution.util';
import type { TenantContext } from '../../../shared/tenant/tenant-context';
import { requireStoreContext } from '../../../shared/tenant/tenant.util';
import type { Request } from 'express';

interface GqlContext {
  req: Request & { tenantContext?: TenantContext };
}

function tenantFrom(ctx: GqlContext): TenantContext {
  const tenant = ctx.req.tenantContext;
  if (!tenant) {
    throw new UnauthorizedException('Missing tenant context');
  }
  return tenant;
}

@Resolver(() => CartType)
@UseGuards(StorefrontAuthGuard)
export class CartResolver {
  constructor(
    private readonly cartService: CartService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Query(() => CartType, { nullable: true, description: 'Get a cart by ID' })
  async cart(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
  ): Promise<CartType | null> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.getCart(
      cartId,
      organizationId,
      storeId,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, {
    description:
      'Create a new empty cart, optionally declaring where the visitor came ' +
      'from. Attribution is optional — omitting it degrades campaign ' +
      'reporting and never fails the mutation.',
  })
  async createCart(
    @Context() ctx: GqlContext,
    @Args('attribution', { type: () => CartAttributionInput, nullable: true })
    attribution?: CartAttributionInput,
  ): Promise<CartType> {
    const tenant = tenantFrom(ctx);
    const { organizationId, storeId } = requireStoreContext(tenant);
    const result = await this.cartService.createCart(
      organizationId,
      storeId,
      tenant.customerId,
      attribution,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, {
    description:
      'Record a new arrival on an existing cart. The first touch is written ' +
      'once and never overwritten; the last touch advances. Attribution ' +
      'already copied onto an order at checkout is never changed by this.',
  })
  async recordCartAttribution(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
    @Args('attribution', { type: () => CartAttributionInput })
    attribution: CartAttributionInput,
  ): Promise<CartType> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.recordAttribution(
      cartId,
      organizationId,
      storeId,
      attribution,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, { description: 'Add a variant to the cart' })
  async addToCart(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
    @Args('variantId', { type: () => ID }) variantId: string,
    @Args('quantity', { type: () => Int }) quantity: number,
  ): Promise<CartType> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.addItem(
      cartId,
      variantId,
      quantity,
      organizationId,
      storeId,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, {
    description:
      'Update the quantity of a cart item. Set quantity to 0 to remove.',
  })
  async updateCartItem(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
    @Args('itemId', { type: () => ID }) itemId: string,
    @Args('quantity', { type: () => Int }) quantity: number,
  ): Promise<CartType> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.updateItem(
      cartId,
      itemId,
      quantity,
      organizationId,
      storeId,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, { description: 'Remove a line item from the cart' })
  async removeFromCart(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
    @Args('itemId', { type: () => ID }) itemId: string,
  ): Promise<CartType> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.removeItem(
      cartId,
      itemId,
      organizationId,
      storeId,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, { description: 'Apply a coupon code to the cart' })
  async applyCoupon(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
    @Args('code') code: string,
  ): Promise<CartType> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.applyCoupon(
      cartId,
      code,
      organizationId,
      storeId,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CartType, {
    description: 'Remove the applied coupon from the cart',
  })
  async removeCoupon(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
  ): Promise<CartType> {
    const { organizationId, storeId } = requireStoreContext(tenantFrom(ctx));
    const result = await this.cartService.removeCoupon(
      cartId,
      organizationId,
      storeId,
    );
    return this.toCartType(result, organizationId, storeId);
  }

  @Mutation(() => CheckoutResultType, {
    description: 'Convert a cart to an order and create a Stripe PaymentIntent',
  })
  async checkout(
    @Context() ctx: GqlContext,
    @Args('cartId', { type: () => ID }) cartId: string,
    @Args('input') input: CheckoutInput,
  ): Promise<CheckoutResultType> {
    const tenant = tenantFrom(ctx);
    return this.checkoutService.checkout(cartId, input, tenant);
  }

  /**
   * Maps a CartWithItems to the GraphQL CartType, enriching each line item with
   * the display data the storefront needs (product name, slug, primary image).
   * Product snapshots are batch-resolved in one round trip (no N+1).
   */
  private async toCartType(
    cart: CartWithItems,
    orgId: string,
    storeId: string,
  ): Promise<CartType> {
    const productIds = [
      ...new Set(cart.items.map((item) => item.variant.productId)),
    ];
    const snapshots = await this.cartService.getProductSnapshots(
      productIds,
      orgId,
      storeId,
    );

    return {
      id: cart.id,
      organizationId: cart.organizationId,
      customerId: cart.customerId,
      status: cart.status,
      couponCode: cart.couponCode,
      subtotal: cart.subtotal,
      discountAmount: cart.discountAmount,
      taxAmount: cart.taxAmount,
      shippingAmount: cart.shippingAmount,
      total: cart.total,
      currency: cart.currency,
      items: cart.items.map((item) =>
        toCartItemType(item, snapshots.get(item.variant.productId)),
      ),
      attribution: toCartAttributionType(pickAttribution(cart)),
      expiresAt: cart.expiresAt,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  }
}

function toCartItemType(
  item: CartWithItems['items'][number],
  snapshot?: { name: string; slug: string; imageUrl: string | null },
): CartItemType {
  return {
    id: item.id,
    cartId: item.cartId,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    // Display data. Fall back to the variant's own fields if the product row
    // can't be resolved (e.g. just-deleted product) so the cart still renders.
    productName: snapshot?.name ?? item.variant.name ?? item.variant.sku,
    productSlug: snapshot?.slug ?? '',
    variantName: item.variant.name,
    sku: item.variant.sku,
    imageUrl: snapshot?.imageUrl ?? null,
    // CartItemWithVariant doesn't carry DB timestamps — use now as fallback.
    // The actual timestamps live on the CartItem row returned from the repo.
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
