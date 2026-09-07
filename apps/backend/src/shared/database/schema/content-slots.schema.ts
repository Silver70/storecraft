import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

/**
 * The shape of a Slot's content, mirroring the closed set the editing protocol
 * carries. It is what lets the admin offer the right editor and what a stored
 * value is bounded against, so a Slot cannot end up holding something the
 * storefront that declared it cannot render.
 */
export const contentSlotTypeEnum = pgEnum('content_slot_type', [
  'heading',
  'text',
]);

export type ContentSlotType = (typeof contentSlotTypeEnum.enumValues)[number];

/**
 * Whether the Slot's published value is the merchant's latest word on it.
 * `draft` means there is unpublished work waiting — including a Slot that has
 * never been published at all, which is the state every Slot starts in.
 */
export const contentSlotStatusEnum = pgEnum('content_slot_status', [
  'draft',
  'published',
]);

export type ContentSlotStatus =
  (typeof contentSlotStatusEnum.enumValues)[number];

export const CONTENT_SLOT_LIMITS = {
  key: 64,
} as const;

/** The longest a value of each content type may be, once reduced to text. */
export const CONTENT_SLOT_VALUE_LIMITS: Record<ContentSlotType, number> = {
  heading: 120,
  text: 2000,
};

/**
 * The most a request body may carry before anything looks at it. Generous
 * against the limits above because what arrives may still be a word
 * processor's markup, which reduces to a fraction of its size — but bounded,
 * because an editing channel that accepts an unbounded paste is an outage.
 */
export const CONTENT_SLOT_RAW_LIMIT = 16 * 1024;

/**
 * A named region a storefront renders at a stable key, holding typed content.
 * Not a page, and not composed of nested blocks — a Slot is one value the
 * storefront asked for by name.
 *
 * There is deliberately **no version history**: a Slot holds what is published
 * and what is being drafted, and nothing else. Restore, diffing, and retention
 * are a designed feature rather than a column, and a table nobody reads would
 * be storage for a feature that does not exist yet.
 *
 * `value` is what shoppers see and is the only column the public storefront
 * read ever touches. `draft_value` is the merchant's unpublished work and has
 * no path to the public API at all.
 */
export const contentSlots = pgTable(
  'content_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    /** The stable address the storefront renders at — `homepage.hero`. */
    key: varchar('key', { length: CONTENT_SLOT_LIMITS.key }).notNull(),
    type: contentSlotTypeEnum('type').notNull(),
    /**
     * The published value. Null until the merchant has published once, which
     * is what makes a Slot render nothing rather than scaffolding.
     */
    value: text('value'),
    /** Unpublished work. Null when there is none. Never public. */
    draftValue: text('draft_value'),
    status: contentSlotStatusEnum('status').notNull().default('draft'),
    lastPublishedAt: timestamp('last_published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // A key is unique per Store, so the same key in two Stores is two
    // different Slots. The database is the authority on that, not the read
    // that preceded the insert.
    unique('content_slots_store_key_unique').on(t.storeId, t.key),
    index('content_slots_org_store_idx').on(t.organizationId, t.storeId),
  ],
);

export type ContentSlot = typeof contentSlots.$inferSelect;
export type NewContentSlot = typeof contentSlots.$inferInsert;
