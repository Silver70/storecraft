/**
 * The measurement contract, as the storefront sees it.
 *
 * Mirrors `MeasurementSettings` on the commerce API (see
 * `apps/backend/src/modules/ad-platform/models/measurement.model.ts`). Nothing
 * here is configured in this app: the pixel arrives from the API because
 * connecting an ad platform is meant to switch measurement on without a deploy,
 * and disconnecting to switch it off the same way.
 */

/** What the store says about measuring, read on every page. */
export interface MeasurementSettings {
  /** The ad platform's pixel, or null when the store has no connection. */
  pixelId: string | null;
  /** Whether a visitor must be asked before anything is measured. */
  consentRequired: boolean;
}

/**
 * A visitor's answer, or `null` where they have not answered — which is not a
 * third answer but the absence of one. A store that requires consent treats
 * anything other than `"granted"` as no.
 */
export type ConsentAnswer = "granted" | "denied" | null;

/** Settings plus the visitor's answer as the server saw it on this request. */
export interface Measurement extends MeasurementSettings {
  consent: ConsentAnswer;
}

/** Meta's browser identifiers, as read from this browser's own cookies. */
export interface BrowserIds {
  /** `_fbp` — this browser, stable across visits. */
  metaBrowserId?: string;
  /** `_fbc` — the ad click that brought them, captured at landing. */
  metaClickId?: string;
}
