import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

export const discountTypeEnum = pgEnum('discount_type', [
  'percentage',
  'fixed_amount',
]);

export const discountScopeEnum = pgEnum('discount_scope', [
  'product',
  'category',
  'order',
]);

export const discounts = pgTable('discounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: discountTypeEnum('type').notNull(),
  // basis points when type = 'percentage' (2000 = 20%), cents when 'fixed_amount'
  value: integer('value').notNull(),
  scope: discountScopeEnum('scope').notNull().default('order'),
  scopeId: uuid('scope_id'),
  minOrderAmount: integer('min_order_amount'),
  isActive: boolean('is_active').notNull().default(true),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Discount = typeof discounts.$inferSelect;
export type NewDiscount = typeof discounts.$inferInsert;
