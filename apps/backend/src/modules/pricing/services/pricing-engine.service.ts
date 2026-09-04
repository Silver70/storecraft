import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { taxRates } from '../../../shared/database/schema';
import { applyPercentage, subtract } from '../../../shared/utils/money.util';
import { DiscountRepository } from '../repositories/discount.repository';
import type { Discount, Coupon } from '../../../shared/database/schema';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface CartItemWithVariant {
  id: string;
  cartId: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  organizationId: string;
  storeId: string;
  variant: {
    id: string;
    productId: string;
    price: number;
    isActive: boolean;
    sku: string;
    name: string | null;
  };
  productCategoryIds: string[];
}

export interface PricedItem {
  variantId: string;
  lineTotal: number;
}

export interface ShippingAddressInput {
  countryCode: string;
  stateCode?: string | null;
}

interface DiscountLineItem {
  type: 'product' | 'category' | 'order' | 'coupon';
  discountId?: string;
  couponId?: string;
  amount: number;
  description: string;
}

export interface DiscountItemResult {
  variantId: string;
  originalLineTotal: number;
  discountedLineTotal: number;
  discountAmount: number;
  discountLines: DiscountLineItem[];
}

export interface DiscountResult {
  items: DiscountItemResult[];
  orderDiscountAmount: number;
  couponDiscountAmount: number;
  totalDiscountAmount: number;
  isFreeShipping: boolean;
  couponId?: string;
}

export interface TaxResult {
  taxAmount: number;
  taxRateId?: string;
  rateBasisPoints: number;
  isInclusive: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PricingEngineService {
  constructor(
    private readonly discountRepo: DiscountRepository,
    @Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient,
  ) {}

  async applyDiscounts(
    items: CartItemWithVariant[],
    couponCode: string | null,
    orgId: string,
    storeId: string,
  ): Promise<DiscountResult> {
    if (items.length === 0) {
      return {
        items: [],
        orderDiscountAmount: 0,
        couponDiscountAmount: 0,
        totalDiscountAmount: 0,
        isFreeShipping: false,
      };
    }

    const productIds = [...new Set(items.map((i) => i.variant.productId))];
    const categoryIds = [
      ...new Set(items.flatMap((i) => i.productCategoryIds)),
    ];

    const [productDiscounts, categoryDiscounts, orderDiscounts] =
      await Promise.all([
        this.discountRepo.findActiveProductDiscounts(
          orgId,
          storeId,
          productIds,
        ),
        this.discountRepo.findActiveCategoryDiscounts(
          orgId,
          storeId,
          categoryIds,
        ),
        this.discountRepo.findActiveOrderDiscounts(orgId, storeId),
      ]);

    // ── Step 1 & 2: Apply item-level discounts ──────────────────────────────
    const itemResults: DiscountItemResult[] = items.map((item) => {
      const lineTotal = item.quantity * item.unitPrice;

      const applicableProductDiscounts = productDiscounts.filter(
        (d) => d.scopeId === item.variant.productId,
      );
      const applicableCategoryDiscounts = categoryDiscounts.filter(
        (d) =>
          d.scopeId !== null && item.productCategoryIds.includes(d.scopeId),
      );

      const allItemDiscounts = [
        ...applicableProductDiscounts,
        ...applicableCategoryDiscounts,
      ];

      if (allItemDiscounts.length === 0) {
        return {
          variantId: item.variantId,
          originalLineTotal: lineTotal,
          discountedLineTotal: lineTotal,
          discountAmount: 0,
          discountLines: [],
        };
      }

      // Take the single most favorable discount per item to avoid stacking
      const bestDiscount = allItemDiscounts.reduce((best, d) => {
        const bestAmount = computeDiscountAmount(d, lineTotal);
        const dAmount = computeDiscountAmount(d, lineTotal);
        return dAmount > bestAmount ? d : best;
      });

      const discountAmount = computeDiscountAmount(bestDiscount, lineTotal);
      const discountedLineTotal = Math.max(
        0,
        subtract(lineTotal, discountAmount),
      );
      const discountType: 'product' | 'category' =
        bestDiscount.scope === 'product' ? 'product' : 'category';

      return {
        variantId: item.variantId,
        originalLineTotal: lineTotal,
        discountedLineTotal,
        discountAmount,
        discountLines: [
          {
            type: discountType,
            discountId: bestDiscount.id,
            amount: discountAmount,
            description: bestDiscount.name,
          },
        ],
      };
    });

    const subtotalAfterItemDiscounts = itemResults.reduce(
      (sum, r) => sum + r.discountedLineTotal,
      0,
    );

    // ── Step 3: Apply order-level discounts ─────────────────────────────────
    let orderDiscountAmount = 0;
    const eligibleOrderDiscounts = orderDiscounts.filter(
      (d) =>
        d.minOrderAmount === null ||
        subtotalAfterItemDiscounts >= d.minOrderAmount,
    );

    if (eligibleOrderDiscounts.length > 0) {
      const bestOrderDiscount = eligibleOrderDiscounts.reduce((best, d) => {
        const bestAmt = computeDiscountAmount(best, subtotalAfterItemDiscounts);
        const dAmt = computeDiscountAmount(d, subtotalAfterItemDiscounts);
        return dAmt > bestAmt ? d : best;
      });
      orderDiscountAmount = computeDiscountAmount(
        bestOrderDiscount,
        subtotalAfterItemDiscounts,
      );
    }

    const subtotalAfterOrderDiscounts = Math.max(
      0,
      subtract(subtotalAfterItemDiscounts, orderDiscountAmount),
    );

    // ── Step 4: Apply coupon ────────────────────────────────────────────────
    let couponDiscountAmount = 0;
    let isFreeShipping = false;
    let couponId: string | undefined;

    if (couponCode) {
      const coupon = await this.discountRepo.findCouponByCode(
        couponCode,
        orgId,
        storeId,
      );
      this.validateCoupon(coupon, subtotalAfterOrderDiscounts, couponCode);

      couponId = coupon.id;

      if (coupon.type === 'free_shipping') {
        isFreeShipping = true;
      } else {
        couponDiscountAmount = computeCouponAmount(
          coupon,
          subtotalAfterOrderDiscounts,
        );
      }
    }

    const totalItemDiscountAmount = itemResults.reduce(
      (sum, r) => sum + r.discountAmount,
      0,
    );
    const totalDiscountAmount =
      totalItemDiscountAmount + orderDiscountAmount + couponDiscountAmount;

    return {
      items: itemResults,
      orderDiscountAmount,
      couponDiscountAmount,
      totalDiscountAmount,
      isFreeShipping,
      couponId,
    };
  }

  async calculateTax(
    pricedItems: PricedItem[],
    shippingAddress: ShippingAddressInput,
    orgId: string,
    storeId: string,
  ): Promise<TaxResult> {
    // Try exact state match first, fall back to country-only
    const conditions = [
      eq(taxRates.organizationId, orgId),
      eq(taxRates.storeId, storeId),
      eq(taxRates.isActive, true),
      eq(taxRates.countryCode, shippingAddress.countryCode),
    ];

    const allRates = await this.db
      .select()
      .from(taxRates)
      .where(and(...conditions));

    const stateCode = shippingAddress.stateCode ?? null;
    const exactMatch = stateCode
      ? allRates.find((r) => r.stateCode === stateCode)
      : null;
    const countryMatch = allRates.find((r) => r.stateCode === null);
    const taxRate = exactMatch ?? countryMatch ?? null;

    if (!taxRate) {
      return { taxAmount: 0, rateBasisPoints: 0, isInclusive: false };
    }

    const subtotal = pricedItems.reduce((sum, i) => sum + i.lineTotal, 0);
    let taxAmount: number;

    if (taxRate.isInclusive) {
      // Tax is already included in the price — back-calculate
      // tax = subtotal - subtotal / (1 + rate/10000)
      taxAmount = Math.round(subtotal - subtotal / (1 + taxRate.rate / 10000));
    } else {
      taxAmount = applyPercentage(subtotal, taxRate.rate);
    }

    return {
      taxAmount,
      taxRateId: taxRate.id,
      rateBasisPoints: taxRate.rate,
      isInclusive: taxRate.isInclusive,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private validateCoupon(
    coupon: Coupon | null,
    subtotal: number,
    code: string,
  ): asserts coupon is Coupon {
    if (!coupon) {
      throw new BadRequestException(`Coupon code "${code}" is not valid`);
    }
    if (!coupon.isActive) {
      throw new BadRequestException(`Coupon "${code}" is not active`);
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException(`Coupon "${code}" is not yet active`);
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw new BadRequestException(`Coupon "${code}" has expired`);
    }
    if (
      coupon.maxUsageCount !== null &&
      coupon.usageCount >= coupon.maxUsageCount
    ) {
      throw new BadRequestException(
        `Coupon "${code}" has reached its usage limit`,
      );
    }
    if (coupon.minOrderAmount !== null && subtotal < coupon.minOrderAmount) {
      throw new BadRequestException(
        `Order minimum of ${coupon.minOrderAmount} cents required for coupon "${code}"`,
      );
    }
  }
}

// ─── Pure helpers (module-private) ────────────────────────────────────────────

// `value` is basis points for percentage (2000 = 20%), cents for fixed_amount.
// Both branches cap at the amount being discounted so totals never go negative.
function computeDiscountAmount(discount: Discount, lineTotal: number): number {
  if (discount.type === 'percentage') {
    return Math.min(applyPercentage(lineTotal, discount.value), lineTotal);
  }
  return Math.min(discount.value, lineTotal);
}

function computeCouponAmount(coupon: Coupon, subtotal: number): number {
  if (coupon.type === 'percentage') {
    return Math.min(applyPercentage(subtotal, coupon.value), subtotal);
  }
  if (coupon.type === 'fixed_amount') {
    return Math.min(coupon.value, subtotal);
  }
  return 0; // free_shipping handled separately
}
