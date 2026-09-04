import type { AttributionSource } from '../database/schema';

/**
 * One arrival, as a storefront describes it: the UTM tuple it landed with, the
 * referrer that sent it, the path it landed on, and when it happened.
 *
 * Every field is optional. A Touch carrying no UTM value and no referrer is
 * *direct* — it is evidence of nothing and never becomes a First or Last Touch.
 */
export interface TouchInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  /**
   * When the arrival happened. Storefronts persist a First Touch across
   * sessions, so this is often days before the cart exists. Defaults to now,
   * and a future timestamp is clamped to now.
   */
  occurredAt?: Date | null;
}

/** What a storefront may declare about a cart's visitor. All of it optional. */
export interface DeclaredAttributionInput {
  firstTouch?: TouchInput | null;
  lastTouch?: TouchInput | null;
  visitorId?: string | null;
  sessionId?: string | null;
}

/**
 * The attribution column group as stored on a cart or an order — the shape of
 * `attributionColumns()` in the schema.
 */
export interface AttributionSnapshot {
  attributionSource: AttributionSource;
  visitorId: string | null;
  sessionId: string | null;
  firstTouchUtmSource: string | null;
  firstTouchUtmMedium: string | null;
  firstTouchUtmCampaign: string | null;
  firstTouchUtmContent: string | null;
  firstTouchReferrer: string | null;
  firstTouchLandingPath: string | null;
  firstTouchAt: Date | null;
  lastTouchUtmSource: string | null;
  lastTouchUtmMedium: string | null;
  lastTouchUtmCampaign: string | null;
  lastTouchUtmContent: string | null;
  lastTouchReferrer: string | null;
  lastTouchLandingPath: string | null;
  lastTouchAt: Date | null;
}

/** The columns a write changes. Absent keys are left exactly as they are. */
export type AttributionPatch = Partial<AttributionSnapshot>;
