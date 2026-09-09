import {
  pgTable,
  uuid,
  varchar,
  char,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.schema';
import { stores } from './stores.schema';

// Append-only storefront event log powering traffic-source, funnel, device,
// location, channel, click, form, and true-conversion analytics. Headless: any
// frontend POSTs events to the ingest API (or embeds the `ca.js` drop-in) with
// its own `session_id` + attribution — this table just stores them.
//
// Phase 3 widened this from a fixed 5-stage funnel logger into a general
// behavioral collector: `event_type` moved from a closed pgEnum to varchar (open
// taxonomy, validated at the app layer) and gained a `properties` bag plus
// server-derived device/geo columns. Reserved event types:
//   page_view | product_view | add_to_cart | checkout_start | purchase   (funnel)
//   session_start | click | form_submit | custom                        (Phase 3)
//
// `product_id` / `variant_id` are intentionally NOT foreign keys so an event
// survives the product being deleted and never fails to insert on an unknown id.
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    // Persistent anonymous visitor id (survives across sessions) — the unit of
    // "returning visitor" and accurate cross-session uniques. Nullable: callers
    // that only supply a session id (Phase 2 integrators) still work.
    visitorId: varchar('visitor_id', { length: 128 }),
    // Caller-supplied session identifier — the funnel grouping key and the unit
    // of "unique visitor" in Phase 2's session-only queries. Opaque to us.
    sessionId: varchar('session_id', { length: 128 }).notNull(),
    // Open taxonomy (see reserved names above). Validated in the ingest DTO.
    eventType: varchar('event_type', { length: 48 }).notNull(),
    // Human label for click / custom events, e.g. "Add to cart button" or a
    // custom event name like "newsletter_signup".
    eventName: varchar('event_name', { length: 128 }),
    productId: uuid('product_id'),
    variantId: uuid('variant_id'),
    path: varchar('path', { length: 1024 }),
    referrer: varchar('referrer', { length: 1024 }),
    utmSource: varchar('utm_source', { length: 255 }),
    utmMedium: varchar('utm_medium', { length: 255 }),
    utmCampaign: varchar('utm_campaign', { length: 255 }),
    // Which creative the visitor clicked. The Ad Tag half of the pair the
    // per-Ad traffic join reads (`utm_campaign` names the Campaign, this names
    // the Ad within it) — the same two-pass resolution ADR-0004 defines for
    // Orders, run over the event stream instead. Nullable and never backfilled:
    // an event that arrived before this column existed carries no Ad Tag and is
    // absent from the per-Ad figures rather than counted against some Ad.
    utmContent: varchar('utm_content', { length: 255 }),
    // Server-derived from the request User-Agent at ingest (Phase 3.2). `bot`
    // is a device_type value so bot traffic can be filtered out of human counts.
    deviceType: varchar('device_type', { length: 16 }),
    browser: varchar('browser', { length: 64 }),
    os: varchar('os', { length: 64 }),
    // Server-derived from a CDN geo header at ingest; the raw IP is never stored.
    countryCode: char('country_code', { length: 2 }),
    region: varchar('region', { length: 128 }),
    // Arbitrary caller attributes + click/form detail (element tag, text, href,
    // form id, field names — never field values). Not indexed.
    properties: jsonb('properties').$type<Record<string, unknown>>(),
    // When the event happened on the client (caller-supplied); defaults to
    // ingest time. Kept separate from created_at (server insert time).
    occurredAt: timestamp('occurred_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('analytics_events_org_store_time_idx').on(
      t.organizationId,
      t.storeId,
      t.occurredAt,
    ),
    index('analytics_events_org_store_session_idx').on(
      t.organizationId,
      t.storeId,
      t.sessionId,
    ),
    index('analytics_events_org_store_type_time_idx').on(
      t.organizationId,
      t.storeId,
      t.eventType,
      t.occurredAt,
    ),
    index('analytics_events_org_store_visitor_idx').on(
      t.organizationId,
      t.storeId,
      t.visitorId,
    ),
    index('analytics_events_org_store_name_time_idx').on(
      t.organizationId,
      t.storeId,
      t.eventName,
      t.occurredAt,
    ),
  ],
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
