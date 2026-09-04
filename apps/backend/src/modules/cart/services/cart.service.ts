import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CartRepository } from '../repositories/cart.repository';
import { CartAttributionService } from './cart-attribution.service';
import { PricingEngineService } from '../../pricing/services/pricing-engine.service';
import { PriceResolverService } from '../../pricing/services/price-resolver.service';
import { DiscountRepository } from '../../pricing/repositories/discount.repository';
import { add, subtract } from '../../../shared/utils/money.util';
import type { CartItemWithVariant } from '../../pricing/services/pricing-engine.service';
import type { CartWithItems } from '../repositories/cart.repository';
import type { Cart } from '../../../shared/database/schema';
import type { DeclaredAttributionInput } from '../../../shared/attribution/attribution.types';

/**
 * Idle window after which an `active` cart holding items is considered
 * abandoned. A cart's `updatedAt` is bumped on every mutation (each add/update/
 * remove/coupon change recalculates totals), so this is measured from the last
 * activity, not creation.
 */
const CART_ABANDON_MINUTES = 60;

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly cartRepo: CartRepository,
    private readonly pricingEngine: PricingEngineService,
    private readonly priceResolver: PriceResolverService,
    private readonly discountRepo: DiscountRepository,
    private readonly attribution: CartAttributionService,
  ) {}

  /**
   * Flips `active` carts that still hold items but have been idle past
   * {@link CART_ABANDON_MINUTES} to `abandoned`. Without this sweep carts never
   * leave `active`, leaving the dashboard conversion rate
   * (`converted / (converted + abandoned)`) with an empty denominator. Runs
   * every 15 minutes across all tenants.
   */
  @Cron('*/15 * * * *')
  async expireStaleCarts(): Promise<void> {
    const staleBefore = new Date(Date.now() - CART_ABANDON_MINUTES * 60_000);
    const count = await this.cartRepo.markStaleCartsAbandoned(staleBefore);
    if (count > 0) {
      this.logger.log(`Marked ${count} stale cart(s) as abandoned`);
    }
  }

  async createCart(
    orgId: string,
    storeId: string,
    customerId?: string,
    attribution?: DeclaredAttributionInput,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.create(
      orgId,
      storeId,
      customerId,
      this.attribution.buildPatch(null, attribution),
    );
    return { ...cart, items: [] };
  }

  /**
   * Folds a new arrival into a cart's attribution: the first touch is written
   * once and never overwritten, the last touch advances.
   *
   * Deliberately not gated on the cart still being `active`. Attribution is
   * evidence about a visitor, not commerce state — it moves no money and
   * changes no total — and a converted cart's order already carries its own
   * frozen copy, so a late touch arriving after checkout updates the cart and
   * leaves the order exactly as it was purchased.
   */
  async recordAttribution(
    cartId: string,
    orgId: string,
    storeId: string,
    attribution: DeclaredAttributionInput,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');

    const updated = await this.cartRepo.updateAttribution(
      cartId,
      orgId,
      storeId,
      this.attribution.buildPatch(cart, attribution),
    );
    if (!updated) throw new NotFoundException('Cart not found');

    return this.getCart(cartId, orgId, storeId);
  }

  async getCart(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findWithItems(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');
    return cart;
  }

  async addItem(
    cartId: string,
    variantId: string,
    quantity: number,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.status !== 'active') {
      throw new UnprocessableEntityException('Cart is no longer active');
    }

    const variant = await this.cartRepo.findVariant(variantId, orgId, storeId);
    if (!variant) {
      throw new NotFoundException('Variant not found or not active');
    }

    // Resolve the contract (price-list) price for this customer before stamping
    // the line item. recalculate() re-resolves the whole cart afterward too.
    const resolved = await this.priceResolver.resolve(
      [variantId],
      { orgId, storeId, customerId: cart.customerId },
      new Map([[variantId, variant.price]]),
    );
    const unitPrice = resolved.get(variantId)?.unitPrice ?? variant.price;

    await this.cartRepo.upsertItem(
      cartId,
      variantId,
      quantity,
      unitPrice,
      orgId,
      storeId,
    );

    return this.recalculate(cartId, orgId, storeId);
  }

  async updateItem(
    cartId: string,
    itemId: string,
    quantity: number,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.status !== 'active') {
      throw new UnprocessableEntityException('Cart is no longer active');
    }

    const item = await this.cartRepo.findItem(cartId, itemId, orgId, storeId);
    if (!item) throw new NotFoundException('Cart item not found');

    if (quantity === 0) {
      await this.cartRepo.removeItem(cartId, itemId, orgId, storeId);
    } else {
      await this.cartRepo.updateItemQuantity(
        cartId,
        itemId,
        quantity,
        orgId,
        storeId,
      );
    }

    return this.recalculate(cartId, orgId, storeId);
  }

  async removeItem(
    cartId: string,
    itemId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.status !== 'active') {
      throw new UnprocessableEntityException('Cart is no longer active');
    }

    const item = await this.cartRepo.findItem(cartId, itemId, orgId, storeId);
    if (!item) throw new NotFoundException('Cart item not found');

    await this.cartRepo.removeItem(cartId, itemId, orgId, storeId);
    return this.recalculate(cartId, orgId, storeId);
  }

  async applyCoupon(
    cartId: string,
    code: string,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.status !== 'active') {
      throw new UnprocessableEntityException('Cart is no longer active');
    }

    // Validate coupon exists before applying — full validation happens in recalculate
    const coupon = await this.discountRepo.findCouponByCode(
      code,
      orgId,
      storeId,
    );
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException(`Coupon code "${code}" is not valid`);
    }

    await this.cartRepo.setCoupon(
      cartId,
      orgId,
      storeId,
      coupon.id,
      coupon.code,
    );
    return this.recalculate(cartId, orgId, storeId);
  }

  async removeCoupon(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cart = await this.cartRepo.findById(cartId, orgId, storeId);
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.status !== 'active') {
      throw new UnprocessableEntityException('Cart is no longer active');
    }

    await this.cartRepo.setCoupon(cartId, orgId, storeId, null, null);
    return this.recalculate(cartId, orgId, storeId);
  }

  async recalculate(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems> {
    const cartWithItems = await this.cartRepo.findWithItems(
      cartId,
      orgId,
      storeId,
    );
    if (!cartWithItems) throw new NotFoundException('Cart not found');

    const { items, couponCode } = cartWithItems;

    // Re-resolve contract (price-list) prices each recalc so the cart reflects
    // current pricing — important when a guest cart is later associated to a
    // customer, or when an admin edits a list. Persists + mutates `items`.
    await this.applyContractPricing(
      items,
      orgId,
      storeId,
      cartWithItems.customerId,
    );

    // Subtotal = sum of all item line totals at current unit prices
    const subtotal = items.reduce(
      (sum, item) => add(sum, item.quantity * item.unitPrice),
      0,
    );

    if (items.length === 0) {
      await this.cartRepo.updateTotals(cartId, orgId, storeId, {
        subtotal: 0,
        discountAmount: 0,
        taxAmount: 0,
        shippingAmount: 0,
        total: 0,
      });
      return {
        ...cartWithItems,
        subtotal: 0,
        discountAmount: 0,
        taxAmount: 0,
        shippingAmount: 0,
        total: 0,
      };
    }

    // Apply discounts (tax and shipping calculated at checkout)
    const discountResult = await this.pricingEngine.applyDiscounts(
      items,
      couponCode ?? null,
      orgId,
      storeId,
    );

    const discountAmount = discountResult.totalDiscountAmount;
    const total = Math.max(0, subtract(subtotal, discountAmount));

    const updated = await this.cartRepo.updateTotals(cartId, orgId, storeId, {
      subtotal,
      discountAmount,
      taxAmount: 0,
      shippingAmount: 0,
      total,
      couponId: discountResult.couponId ?? cartWithItems.couponId,
    });

    if (!updated) throw new NotFoundException('Cart not found after update');

    return { ...updated, items };
  }

  async getOrCreateActiveCart(
    orgId: string,
    storeId: string,
    customerId?: string,
  ): Promise<CartWithItems> {
    if (customerId) {
      const existing = await this.cartRepo.findByCustomer(
        customerId,
        orgId,
        storeId,
      );
      if (existing) {
        // Recalc on fetch so contract prices refresh when the customer's
        // pricing context is now known (e.g. just logged in).
        return this.recalculate(existing.id, orgId, storeId);
      }
    }
    return this.createCart(orgId, storeId, customerId);
  }

  /**
   * Re-resolves each line item's unit price against the customer's price lists,
   * persisting and mutating the items in place. No-op for empty carts.
   */
  private async applyContractPricing(
    items: CartItemWithVariant[],
    orgId: string,
    storeId: string,
    customerId: string | null,
  ): Promise<void> {
    if (items.length === 0) return;

    const variantIds = items.map((i) => i.variantId);
    const basePrices = new Map(
      items.map((i) => [i.variantId, i.variant.price]),
    );
    const resolved = await this.priceResolver.resolve(
      variantIds,
      { orgId, storeId, customerId },
      basePrices,
    );

    for (const item of items) {
      const next = resolved.get(item.variantId);
      if (next && next.unitPrice !== item.unitPrice) {
        item.unitPrice = next.unitPrice;
        item.totalPrice = item.quantity * next.unitPrice;
        await this.cartRepo.setItemUnitPrice(
          item.id,
          next.unitPrice,
          item.quantity,
        );
      }
    }
  }

  /**
   * Batch-resolve product display data (name, slug, primary image) for a set of
   * products. Used by the cart resolver to enrich line items with the fields the
   * storefront needs to render a cart row.
   */
  async getProductSnapshots(
    productIds: string[],
    orgId: string,
    storeId: string,
  ): Promise<
    Map<string, { name: string; slug: string; imageUrl: string | null }>
  > {
    return this.cartRepo.getProductSnapshots(productIds, orgId, storeId);
  }

  async markConverted(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<Cart> {
    const updated = await this.cartRepo.markConverted(cartId, orgId, storeId);
    if (!updated) throw new NotFoundException('Cart not found');
    return updated;
  }
}
