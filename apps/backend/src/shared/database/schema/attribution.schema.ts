import { pgEnum, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Where an Order's attribution evidence came from.
 *
 * - `declared`   — the storefront passed it explicitly (ADR-0001: authoritative)
 * - `correlated` — inferred from the event log for the cart's session (fallback)
 * - `none`       — no qualifying touch; reported as Unattributed, never spread
 *                  across campaigns
 */
export const attributionSourceEnum = pgEnum('attribution_source', [
  'none',
  'declared',
  'correlated',
]);

export type AttributionSource =
  (typeof attributionSourceEnum.enumValues)[number];

/**
 * Column-length budget, shared with the normalizer so an over-long referrer
 * from a storefront is truncated rather than failing the write. Matches
 * `analytics_events`, which stores the same shapes of value.
 */
export const ATTRIBUTION_LIMITS = {
  utm: 255,
  referrer: 1024,
  landingPath: 1024,
  visitorId: 128,
  sessionId: 128,
} as const;

/**
 * The attribution column group, stamped identically on `carts` and `orders`.
 *
 * Per ADR-0001 these are the immutable fact: the raw UTM tuple, the referrer,
 * and the landing path of the first and last non-direct Touch. No `campaign_id`
 * is recorded — a Campaign is an interpretation resolved from these values by
 * matching rules at read time, so a Campaign created (or corrected) after the
 * fact still claims its history.
 *
 * On a Cart the first-touch group is write-once and the last-touch group
 * advances; at checkout the whole group is copied to the Order and frozen.
 */
export const attributionColumns = () => ({
  attributionSource: attributionSourceEnum('attribution_source')
    .notNull()
    .default('none'),
  /** Persistent anonymous visitor id — the unit attribution follows. */
  visitorId: varchar('visitor_id', { length: ATTRIBUTION_LIMITS.visitorId }),
  /** Current session id — the join key for the correlation fallback. */
  sessionId: varchar('session_id', { length: ATTRIBUTION_LIMITS.sessionId }),

  firstTouchUtmSource: varchar('first_touch_utm_source', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  firstTouchUtmMedium: varchar('first_touch_utm_medium', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  firstTouchUtmCampaign: varchar('first_touch_utm_campaign', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  firstTouchUtmContent: varchar('first_touch_utm_content', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  firstTouchReferrer: varchar('first_touch_referrer', {
    length: ATTRIBUTION_LIMITS.referrer,
  }),
  firstTouchLandingPath: varchar('first_touch_landing_path', {
    length: ATTRIBUTION_LIMITS.landingPath,
  }),
  firstTouchAt: timestamp('first_touch_at'),

  lastTouchUtmSource: varchar('last_touch_utm_source', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  lastTouchUtmMedium: varchar('last_touch_utm_medium', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  lastTouchUtmCampaign: varchar('last_touch_utm_campaign', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  lastTouchUtmContent: varchar('last_touch_utm_content', {
    length: ATTRIBUTION_LIMITS.utm,
  }),
  lastTouchReferrer: varchar('last_touch_referrer', {
    length: ATTRIBUTION_LIMITS.referrer,
  }),
  lastTouchLandingPath: varchar('last_touch_landing_path', {
    length: ATTRIBUTION_LIMITS.landingPath,
  }),
  lastTouchAt: timestamp('last_touch_at'),
});
