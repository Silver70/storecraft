import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

export const couponTypeEnum = pgEnum('coupon_type', [
  'percentage',
  'fixed_amount',
  'free_shipping',
]);

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 100 }).notNull(),
    type: couponTypeEnum('type').notNull(),
    // basis points when type = 'percentage' (2000 = 20%), cents when
    // 'fixed_amount', unused for 'free_shipping'
    value: integer('value').notNull().default(0),
    minOrderAmount: integer('min_order_amount'),
    maxUsageCount: integer('max_usage_count'),
    usageCount: integer('usage_count').notNull().default(0),
    maxUsagePerCustomer: integer('max_usage_per_customer'),
    isActive: boolean('is_active').notNull().default(true),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('coupons_store_code_unique').on(t.storeId, t.code)],
);

export type Coupon = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;
