import { BadRequestException } from '@nestjs/common';
import { PricingEngineService } from './pricing-engine.service';
import type {
  CartItemWithVariant,
  PricedItem,
  ShippingAddressInput,
} from './pricing-engine.service';
import type { DiscountRepository } from '../repositories/discount.repository';
import type { Discount, Coupon } from '../../../shared/database/schema';

const orgId = 'org-1';
const storeId = 'store-1';

function makeItem(
  overrides: Partial<CartItemWithVariant> = {},
): CartItemWithVariant {
  return {
    id: 'item-1',
    cartId: 'cart-1',
    variantId: 'variant-1',
    quantity: 1,
    unitPrice: 1000,
    totalPrice: 1000,
    organizationId: orgId,
    storeId,
    variant: {
      id: 'variant-1',
      productId: 'product-1',
      price: 1000,
      isActive: true,
      sku: 'SKU-1',
      name: 'Test Variant',
    },
    productCategoryIds: [],
    ...overrides,
  };
}

function makeDiscount(overrides: Partial<Discount> = {}): Discount {
  return {
    id: 'discount-1',
    organizationId: orgId,
    storeId,
    name: '10% off',
    type: 'percentage',
    value: 1000,
    scope: 'order',
    scopeId: null,
    minOrderAmount: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    organizationId: orgId,
    storeId,
    code: 'SAVE10',
    type: 'percentage',
    value: 1000,
    minOrderAmount: null,
    maxUsageCount: null,
    maxUsagePerCustomer: null,
    usageCount: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(
  discountRepoMethods: Partial<DiscountRepository> = {},
  dbMethods: { execute?: (sql: unknown) => Promise<{ rows: unknown[] }> } = {},
) {
  const discountRepo = {
    findActiveProductDiscounts: jest.fn().mockResolvedValue([]),
    findActiveCategoryDiscounts: jest.fn().mockResolvedValue([]),
    findActiveOrderDiscounts: jest.fn().mockResolvedValue([]),
    findCouponByCode: jest.fn().mockResolvedValue(null),
    ...discountRepoMethods,
  } as unknown as DiscountRepository;

  const db = {
    select: jest.fn(),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
    ...dbMethods,
  };

  const service = new PricingEngineService(discountRepo, db as never);
  return { service, discountRepo, db };
}

describe('PricingEngineService', () => {
  describe('applyDiscounts', () => {
    it('returns zeroed result for empty cart', async () => {
      const { service } = buildService();
      const result = await service.applyDiscounts([], null, orgId, storeId);
      expect(result.totalDiscountAmount).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('applies a percentage order-level discount', async () => {
      const discount = makeDiscount({ type: 'percentage', value: 1000 });
      const { service } = buildService({
        findActiveOrderDiscounts: jest.fn().mockResolvedValue([discount]),
      });

      const items = [
        makeItem({ quantity: 2, unitPrice: 1000, totalPrice: 2000 }),
      ];
      const result = await service.applyDiscounts(items, null, orgId, storeId);

      // 10% of 2000 = 200
      expect(result.orderDiscountAmount).toBe(200);
      expect(result.totalDiscountAmount).toBe(200);
    });

    it('applies a fixed-amount product-level discount', async () => {
      const discount = makeDiscount({
        id: 'product-discount-1',
        type: 'fixed_amount',
        value: 300,
        scope: 'product',
        scopeId: 'product-1',
      });
      const { service } = buildService({
        findActiveProductDiscounts: jest.fn().mockResolvedValue([discount]),
      });

      const items = [
        makeItem({ quantity: 1, unitPrice: 1000, totalPrice: 1000 }),
      ];
      const result = await service.applyDiscounts(items, null, orgId, storeId);

      expect(result.items[0].discountAmount).toBe(300);
      expect(result.items[0].discountedLineTotal).toBe(700);
      expect(result.totalDiscountAmount).toBe(300);
    });

    it('does not allow fixed discount to exceed line total', async () => {
      const discount = makeDiscount({
        type: 'fixed_amount',
        value: 5000,
        scope: 'product',
        scopeId: 'product-1',
      });
      const { service } = buildService({
        findActiveProductDiscounts: jest.fn().mockResolvedValue([discount]),
      });

      const items = [
        makeItem({ quantity: 1, unitPrice: 500, totalPrice: 500 }),
      ];
      const result = await service.applyDiscounts(items, null, orgId, storeId);

      expect(result.items[0].discountedLineTotal).toBe(0);
      expect(result.items[0].discountAmount).toBe(500);
    });

    it('does not allow a percentage discount over 100% to exceed line total', async () => {
      const discount = makeDiscount({
        type: 'percentage',
        value: 15000, // 150%
        scope: 'product',
        scopeId: 'product-1',
      });
      const { service } = buildService({
        findActiveProductDiscounts: jest.fn().mockResolvedValue([discount]),
      });

      const items = [
        makeItem({ quantity: 1, unitPrice: 500, totalPrice: 500 }),
      ];
      const result = await service.applyDiscounts(items, null, orgId, storeId);

      expect(result.items[0].discountAmount).toBe(500);
      expect(result.items[0].discountedLineTotal).toBe(0);
      expect(result.totalDiscountAmount).toBe(500);
    });

    it('applies percentage coupon after order discounts', async () => {
      const coupon = makeCoupon({ type: 'percentage', value: 2000 });
      const { service } = buildService({
        findCouponByCode: jest.fn().mockResolvedValue(coupon),
      });

      const items = [
        makeItem({ quantity: 1, unitPrice: 1000, totalPrice: 1000 }),
      ];
      const result = await service.applyDiscounts(
        items,
        'SAVE10',
        orgId,
        storeId,
      );

      // 20% of 1000 = 200
      expect(result.couponDiscountAmount).toBe(200);
    });

    it('marks free_shipping coupon without subtracting amount', async () => {
      const coupon = makeCoupon({ type: 'free_shipping', value: 0 });
      const { service } = buildService({
        findCouponByCode: jest.fn().mockResolvedValue(coupon),
      });

      const items = [makeItem()];
      const result = await service.applyDiscounts(
        items,
        'FREE_SHIP',
        orgId,
        storeId,
      );

      expect(result.isFreeShipping).toBe(true);
      expect(result.couponDiscountAmount).toBe(0);
    });

    it('throws when coupon is inactive', async () => {
      const coupon = makeCoupon({ isActive: false });
      const { service } = buildService({
        findCouponByCode: jest.fn().mockResolvedValue(coupon),
      });

      await expect(
        service.applyDiscounts([makeItem()], 'SAVE10', orgId, storeId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when coupon has reached max usage', async () => {
      const coupon = makeCoupon({ maxUsageCount: 5, usageCount: 5 });
      const { service } = buildService({
        findCouponByCode: jest.fn().mockResolvedValue(coupon),
      });

      await expect(
        service.applyDiscounts([makeItem()], 'SAVE10', orgId, storeId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when order is below coupon minimum', async () => {
      const coupon = makeCoupon({ minOrderAmount: 5000 });
      const { service } = buildService({
        findCouponByCode: jest.fn().mockResolvedValue(coupon),
      });

      const items = [
        makeItem({ quantity: 1, unitPrice: 1000, totalPrice: 1000 }),
      ];
      await expect(
        service.applyDiscounts(items, 'SAVE10', orgId, storeId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when coupon code is not found', async () => {
      const { service } = buildService({
        findCouponByCode: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.applyDiscounts([makeItem()], 'INVALID', orgId, storeId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('calculateTax', () => {
    const pricedItems: PricedItem[] = [{ variantId: 'v1', lineTotal: 10000 }];
    const address: ShippingAddressInput = {
      countryCode: 'US',
      stateCode: 'CA',
    };

    it('returns zero tax when no matching rate', async () => {
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
        execute: jest.fn(),
      };
      const { service } = buildService({}, db);
      const result = await service.calculateTax(
        pricedItems,
        address,
        orgId,
        storeId,
      );
      expect(result.taxAmount).toBe(0);
    });

    it('calculates exclusive tax correctly', async () => {
      const taxRate = {
        id: 'tax-1',
        organizationId: orgId,
        storeId,
        countryCode: 'US',
        stateCode: null,
        rate: 725,
        isInclusive: false,
        isActive: true,
      };
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([taxRate]),
          }),
        }),
        execute: jest.fn(),
      };
      const { service } = buildService({}, db);
      const result = await service.calculateTax(
        pricedItems,
        address,
        orgId,
        storeId,
      );
      // 7.25% of 10000 = 725
      expect(result.taxAmount).toBe(725);
      expect(result.rateBasisPoints).toBe(725);
      expect(result.isInclusive).toBe(false);
    });

    it('back-calculates inclusive tax', async () => {
      const taxRate = {
        id: 'tax-2',
        organizationId: orgId,
        storeId,
        countryCode: 'US',
        stateCode: null,
        rate: 1000,
        isInclusive: true,
        isActive: true,
      };
      const db = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([taxRate]),
          }),
        }),
        execute: jest.fn(),
      };
      const { service } = buildService({}, db);
      // 10% inclusive: tax = 10000 - 10000/(1.10) = 10000 - 9090.9 ≈ 909
      const result = await service.calculateTax(
        pricedItems,
        address,
        orgId,
        storeId,
      );
      expect(result.isInclusive).toBe(true);
      expect(result.taxAmount).toBeGreaterThan(0);
      // round(10000 - 10000/1.10) = round(909.09) = 909
      expect(result.taxAmount).toBe(909);
    });
  });
});
