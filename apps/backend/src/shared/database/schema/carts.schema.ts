import {
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { attributionColumns } from './attribution.schema';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

export const cartStatusEnum = pgEnum('cart_status', [
  'active',
  'converted',
  'abandoned',
]);

export const carts = pgTable('carts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id'),
  status: cartStatusEnum('status').notNull().default('active'),
  couponId: uuid('coupon_id'),
  couponCode: varchar('coupon_code', { length: 100 }),
  subtotal: integer('subtotal').notNull().default(0),
  discountAmount: integer('discount_amount').notNull().default(0),
  taxAmount: integer('tax_amount').notNull().default(0),
  shippingAmount: integer('shipping_amount').notNull().default(0),
  total: integer('total').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  expiresAt: timestamp('expires_at'),
  // Where this cart's visitor came from. First touch is write-once, last touch
  // advances with each new non-direct touch, and both are copied onto the order
  // at checkout. See attribution.schema.ts.
  ...attributionColumns(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;
