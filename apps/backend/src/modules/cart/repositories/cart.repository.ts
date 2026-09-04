import { Inject, Injectable } from '@nestjs/common';
import { eq, and, gt, lt, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import {
  carts,
  cartItems,
  products,
  productMedia,
  productVariants,
  productCategories,
} from '../../../shared/database/schema';
import type { Cart, CartItem } from '../../../shared/database/schema';
import type { CartItemWithVariant } from '../../pricing/services/pricing-engine.service';
import type { AttributionPatch } from '../../../shared/attribution/attribution.types';

export interface CartWithItems extends Cart {
  items: CartItemWithVariant[];
}

@Injectable()
export class CartRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findById(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<Cart | null> {
    const [row] = await this.db
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, orgId),
          eq(carts.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findWithItems(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartWithItems | null> {
    const cart = await this.findById(cartId, orgId, storeId);
    if (!cart) return null;

    const items = await this.loadItemsWithVariants(cartId, orgId, storeId);
    return { ...cart, items };
  }

  async findByCustomer(
    customerId: string,
    orgId: string,
    storeId: string,
  ): Promise<Cart | null> {
    const [row] = await this.db
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.organizationId, orgId),
          eq(carts.storeId, storeId),
          eq(carts.customerId, customerId),
          eq(carts.status, 'active'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async create(
    orgId: string,
    storeId: string,
    customerId?: string,
    attribution: AttributionPatch = {},
  ): Promise<Cart> {
    const [cart] = await this.db
      .insert(carts)
      .values({
        organizationId: orgId,
        storeId,
        customerId: customerId ?? null,
        status: 'active',
        ...attribution,
      })
      .returning();
    return cart;
  }

  /**
   * Writes the attribution columns a new touch changes, leaving every other
   * column — the write-once first touch included — exactly as it was. An empty
   * patch is not a write.
   */
  async updateAttribution(
    cartId: string,
    orgId: string,
    storeId: string,
    patch: AttributionPatch,
  ): Promise<Cart | null> {
    if (Object.keys(patch).length === 0) {
      return this.findById(cartId, orgId, storeId);
    }

    const [row] = await this.db
      .update(carts)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, orgId),
          eq(carts.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async updateTotals(
    cartId: string,
    orgId: string,
    storeId: string,
    totals: {
      subtotal: number;
      discountAmount: number;
      taxAmount: number;
      shippingAmount: number;
      total: number;
      couponId?: string | null;
      couponCode?: string | null;
    },
  ): Promise<Cart | null> {
    const [row] = await this.db
      .update(carts)
      .set({
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        shippingAmount: totals.shippingAmount,
        total: totals.total,
        couponId:
          totals.couponId !== undefined ? totals.couponId : sql`coupon_id`,
        couponCode:
          totals.couponCode !== undefined
            ? totals.couponCode
            : sql`coupon_code`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, orgId),
          eq(carts.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async setCoupon(
    cartId: string,
    orgId: string,
    storeId: string,
    couponId: string | null,
    couponCode: string | null,
  ): Promise<Cart | null> {
    const [row] = await this.db
      .update(carts)
      .set({ couponId, couponCode, updatedAt: new Date() })
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, orgId),
          eq(carts.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async markConverted(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<Cart | null> {
    const [row] = await this.db
      .update(carts)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, orgId),
          eq(carts.storeId, storeId),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Bulk-marks abandoned carts: `active` carts that still hold items
   * (`subtotal > 0`) but have had no activity since `staleBefore`. Runs as a
   * global sweep from the cart-expiry cron, so it is intentionally NOT
   * tenant-scoped. Empty carts (auto-created sessions that never had a product
   * added) are left untouched so they never pollute the conversion denominator.
   * Returns the number of carts flipped.
   */
  async markStaleCartsAbandoned(staleBefore: Date): Promise<number> {
    const rows = await this.db
      .update(carts)
      .set({ status: 'abandoned', updatedAt: new Date() })
      .where(
        and(
          eq(carts.status, 'active'),
          gt(carts.subtotal, 0),
          lt(carts.updatedAt, staleBefore),
        ),
      )
      .returning({ id: carts.id });
    return rows.length;
  }

  // ─── Cart Items ─────────────────────────────────────────────────────────────

  async findItem(
    cartId: string,
    itemId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartItem | null> {
    const [row] = await this.db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.id, itemId),
          eq(cartItems.cartId, cartId),
          eq(cartItems.organizationId, orgId),
          eq(cartItems.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findItemByVariant(
    cartId: string,
    variantId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartItem | null> {
    const [row] = await this.db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, cartId),
          eq(cartItems.variantId, variantId),
          eq(cartItems.organizationId, orgId),
          eq(cartItems.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async upsertItem(
    cartId: string,
    variantId: string,
    quantity: number,
    unitPrice: number,
    orgId: string,
    storeId: string,
  ): Promise<CartItem> {
    const existing = await this.findItemByVariant(
      cartId,
      variantId,
      orgId,
      storeId,
    );

    if (existing) {
      const newQty = existing.quantity + quantity;
      const [row] = await this.db
        .update(cartItems)
        .set({
          quantity: newQty,
          totalPrice: newQty * unitPrice,
          updatedAt: new Date(),
        })
        .where(eq(cartItems.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await this.db
      .insert(cartItems)
      .values({
        organizationId: orgId,
        storeId,
        cartId,
        variantId,
        quantity,
        unitPrice,
        totalPrice: quantity * unitPrice,
      })
      .returning();
    return row;
  }

  /** Overwrite a line item's unit price (used when re-resolving contract prices). */
  async setItemUnitPrice(
    itemId: string,
    unitPrice: number,
    quantity: number,
  ): Promise<void> {
    await this.db
      .update(cartItems)
      .set({
        unitPrice,
        totalPrice: quantity * unitPrice,
        updatedAt: new Date(),
      })
      .where(eq(cartItems.id, itemId));
  }

  async updateItemQuantity(
    cartId: string,
    itemId: string,
    quantity: number,
    orgId: string,
    storeId: string,
  ): Promise<CartItem | null> {
    const item = await this.findItem(cartId, itemId, orgId, storeId);
    if (!item) return null;

    const [row] = await this.db
      .update(cartItems)
      .set({
        quantity,
        totalPrice: quantity * item.unitPrice,
        updatedAt: new Date(),
      })
      .where(eq(cartItems.id, itemId))
      .returning();
    return row ?? null;
  }

  async removeItem(
    cartId: string,
    itemId: string,
    orgId: string,
    storeId: string,
  ): Promise<void> {
    await this.db
      .delete(cartItems)
      .where(
        and(
          eq(cartItems.id, itemId),
          eq(cartItems.cartId, cartId),
          eq(cartItems.organizationId, orgId),
          eq(cartItems.storeId, storeId),
        ),
      );
  }

  // ─── Variant lookup (avoids importing ProductModule) ────────────────────────

  async findVariant(
    variantId: string,
    orgId: string,
    storeId: string,
  ): Promise<{
    id: string;
    productId: string;
    price: number;
    isActive: boolean;
    sku: string;
    name: string | null;
  } | null> {
    const [row] = await this.db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        price: productVariants.price,
        isActive: productVariants.isActive,
        sku: productVariants.sku,
        name: productVariants.name,
      })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(productVariants.organizationId, orgId),
          eq(productVariants.storeId, storeId),
          eq(productVariants.isActive, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getProductCategoryIds(productId: string): Promise<string[]> {
    const rows = await this.db
      .select({ categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.productId, productId));
    return rows.map((r) => r.categoryId);
  }

  /**
   * Batch-resolves the product display name and primary image URL for a set of
   * products in two queries (no N+1). Used to snapshot order line items at
   * checkout so an order always shows the product name + image as it was at
   * purchase time, independent of later catalog edits. The primary image is the
   * `is_primary` media row, falling back to the lowest-position image.
   */
  async getProductSnapshots(
    productIds: string[],
    orgId: string,
    storeId: string,
  ): Promise<
    Map<string, { name: string; slug: string; imageUrl: string | null }>
  > {
    const out = new Map<
      string,
      { name: string; slug: string; imageUrl: string | null }
    >();
    if (productIds.length === 0) return out;

    const productRows = await this.db
      .select({ id: products.id, name: products.name, slug: products.slug })
      .from(products)
      .where(
        and(
          inArray(products.id, productIds),
          eq(products.organizationId, orgId),
          eq(products.storeId, storeId),
        ),
      );

    const mediaRows = await this.db
      .select({
        productId: productMedia.productId,
        url: productMedia.url,
        isPrimary: productMedia.isPrimary,
        position: productMedia.position,
      })
      .from(productMedia)
      .where(
        and(
          inArray(productMedia.productId, productIds),
          eq(productMedia.organizationId, orgId),
          eq(productMedia.storeId, storeId),
        ),
      );

    const bestImage = new Map<
      string,
      { url: string; isPrimary: boolean; position: number }
    >();
    for (const m of mediaRows) {
      const cur = bestImage.get(m.productId);
      const isBetter =
        !cur ||
        (m.isPrimary && !cur.isPrimary) ||
        (m.isPrimary === cur.isPrimary && m.position < cur.position);
      if (isBetter) {
        bestImage.set(m.productId, {
          url: m.url,
          isPrimary: m.isPrimary,
          position: m.position,
        });
      }
    }

    for (const p of productRows) {
      out.set(p.id, {
        name: p.name,
        slug: p.slug,
        imageUrl: bestImage.get(p.id)?.url ?? null,
      });
    }
    return out;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async loadItemsWithVariants(
    cartId: string,
    orgId: string,
    storeId: string,
  ): Promise<CartItemWithVariant[]> {
    const rawItems = await this.db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, cartId),
          eq(cartItems.organizationId, orgId),
          eq(cartItems.storeId, storeId),
        ),
      );

    if (rawItems.length === 0) return [];

    const results: CartItemWithVariant[] = [];

    for (const item of rawItems) {
      const variant = await this.findVariant(item.variantId, orgId, storeId);
      if (!variant) continue;

      const productCategoryIds = await this.getProductCategoryIds(
        variant.productId,
      );

      results.push({
        id: item.id,
        cartId: item.cartId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        organizationId: item.organizationId,
        storeId: item.storeId,
        variant,
        productCategoryIds,
      });
    }

    return results;
  }
}
