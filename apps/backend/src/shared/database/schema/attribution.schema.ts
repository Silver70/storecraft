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
 * Whether a visitor agreed to be measured, on a Store that asks.
 *
 * Null is not a third answer — it means the question was never put, because the
 * Store does not require consent or because the visitor arrived before it did.
 * A Store that requires consent treats anything other than `granted` as no.
 */
export const measurementConsentEnum = pgEnum('measurement_consent', [
  'granted',
  'denied',
]);

export type MeasurementConsent =
  (typeof measurementConsentEnum.enumValues)[number];

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
  /** `_fbp` — short and fixed in shape. */
  browserId: 255,
  /** `_fbc` carries the whole click id, which the platform does not bound. */
  clickId: 512,
} as const;

/**
 * The attribution column group, stamped identically on `carts` and `orders`.
 *
 * Per ADR-0001 these are the immutable fact: the raw UTM tuple, the referrer,
 * and the landing path of the first and last non-direct Touch. No `campaign_id`
 * is recorded — the Campaign and Ad are resolved from these values at read
 * time, by the platform ids the Link Tags wrote into `utm_campaign` and
 * `utm_content`, so a Campaign discovered after the fact still claims its
 * history.
 *
 * On a Cart the first-touch group is write-once and the last-touch group
 * advances; at checkout the whole group is copied to the Order and frozen.
 *
 * The group also carries what measurement needs about the same arrival: the ad
 * platform's own browser identifiers, and whether the visitor agreed to be
 * measured at all. They live here rather than in a table of their own for the
 * reason the touches do — they are worthless collected late, and the one moment
 * they can be frozen is the moment the Cart becomes an Order.
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

  /**
   * Meta's browser identifier (`_fbp`) for this visitor, as the storefront read
   * it. Raises how many of our server-side Purchase Events the platform can
   * match to a person, which is the whole reason it is carried.
   */
  metaBrowserId: varchar('meta_browser_id', {
    length: ATTRIBUTION_LIMITS.browserId,
  }),
  /**
   * Meta's click identifier (`_fbc`), derived from the `fbclid` on the link the
   * visitor arrived through. Only ever set at landing: the parameter is gone
   * from the URL by the next page, so a value collected later is no value.
   */
  metaClickId: varchar('meta_click_id', {
    length: ATTRIBUTION_LIMITS.clickId,
  }),
  /**
   * The visitor's answer to the Store's consent banner, or null where they were
   * never asked. Frozen with the rest so a Purchase Event dispatched days after
   * checkout honours the answer that was given at the time.
   */
  measurementConsent: measurementConsentEnum('measurement_consent'),
});
