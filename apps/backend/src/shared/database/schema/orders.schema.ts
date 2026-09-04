import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  pgEnum,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';
import { attributionColumns } from './attribution.schema';

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
]);

export const fulfillmentStatusEnum = pgEnum('fulfillment_status', [
  'unfulfilled',
  'partial',
  'fulfilled',
]);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    customerId: uuid('customer_id'),
    customerEmail: varchar('customer_email', { length: 255 }).notNull(),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    status: orderStatusEnum('status').notNull().default('pending'),
    fulfillmentStatus: fulfillmentStatusEnum('fulfillment_status')
      .notNull()
      .default('unfulfilled'),
    subtotal: integer('subtotal').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    taxAmount: integer('tax_amount').notNull().default(0),
    shippingAmount: integer('shipping_amount').notNull().default(0),
    total: integer('total').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    couponCode: varchar('coupon_code', { length: 100 }),
    shippingAddress: jsonb('shipping_address').notNull(),
    billingAddress: jsonb('billing_address'),
    shippingMethodId: uuid('shipping_method_id'),
    notes: text('notes'),
    source: varchar('source', { length: 50 }).notNull().default('storefront'),
    // Copied from the cart at checkout and never written again — an order's
    // attribution is a snapshot of purchase-time conditions, exactly like its
    // line items. See attribution.schema.ts.
    ...attributionColumns(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('orders_store_number_unique').on(t.storeId, t.orderNumber)],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
