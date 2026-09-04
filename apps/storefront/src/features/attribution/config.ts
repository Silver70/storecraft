/// <reference types="vite/client" />
/**
 * ◄ TEMPLATE KNOB — attribution + tracking.
 *
 * Both settings are build-time (`VITE_*`) because they are read in the browser.
 * Neither is a secret: the lookback window is a policy number, and the tracking
 * key is the publishable ingest key the drop-in script was designed to carry.
 */

/**
 * Thirty days is the industry starting point, matching the backend's
 * `ATTRIBUTION_LOOKBACK_DAYS` default. Set `VITE_ATTRIBUTION_LOOKBACK_DAYS` to
 * the *same* value the backend uses — a storefront that remembers a first touch
 * for longer than the backend counts it just sends touches that never qualify.
 */
const DEFAULT_LOOKBACK_DAYS = 30;

/** A window longer than a year credits ads any honest reading would call spent. */
const MAX_LOOKBACK_DAYS = 365;

/** Falls back rather than throwing: a bad env value must not break a page. */
function resolveLookbackDays(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return DEFAULT_LOOKBACK_DAYS;
  const days = Math.floor(parsed);
  if (days < 1) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(days, MAX_LOOKBACK_DAYS);
}

export const LOOKBACK_DAYS = resolveLookbackDays(
  import.meta.env.VITE_ATTRIBUTION_LOOKBACK_DAYS as string | undefined,
);

/** The window in milliseconds — the unit every comparison against a touch uses. */
export const LOOKBACK_MS = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

/**
 * The drop-in behavioral tracker (`ca.js`), served by the commerce backend.
 *
 * `VITE_ANALYTICS_KEY` is browser-visible by design — it is the `?k=` the
 * script sends with every event batch. Give it its **own** API key, not the
 * `COMMERCE_API_KEY` the server functions use: keys are store-scoped and
 * unscoped beyond that, so a key in the browser is a key anyone can create a
 * cart with. Leave it unset and no script is embedded; attribution capture and
 * checkout are unaffected either way.
 */
const trackingKey = import.meta.env.VITE_ANALYTICS_KEY as string | undefined;
const trackingOrigin = import.meta.env.VITE_ANALYTICS_URL as string | undefined;

export interface TrackingScript {
  src: string;
  key: string;
  /** "none" (default) | "click" | "form" | "all" — see the ca.js header. */
  autocapture: string;
}

export const trackingScript: TrackingScript | null =
  trackingKey && trackingOrigin
    ? {
        src: `${trackingOrigin.replace(/\/+$/, "")}/ca.js`,
        key: trackingKey,
        autocapture:
          (import.meta.env.VITE_ANALYTICS_AUTOCAPTURE as string | undefined) ??
          "none",
      }
    : null;
