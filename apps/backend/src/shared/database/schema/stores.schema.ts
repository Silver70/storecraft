import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { DEFAULT_PRODUCT_PATH_PATTERN } from '../../utils/storefront-url.util';

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),

    // Where this Store's storefront is served, and the shape of its product
    // page paths. The engine is headless, so it cannot know either — a link
    // into the storefront can only be built once a merchant has said. Null
    // until then: optional right up to the moment something needs it.
    storefrontUrl: text('storefront_url'),
    productPathPattern: varchar('product_path_pattern', { length: 255 })
      .notNull()
      .default(DEFAULT_PRODUCT_PATH_PATTERN),

    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('stores_org_slug_unique').on(t.organizationId, t.slug)],
);

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
