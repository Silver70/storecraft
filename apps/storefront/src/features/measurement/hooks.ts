import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { readDeclaredAttribution } from "~/features/attribution/client";
import { trackingScript } from "~/features/attribution/config";
import { syncAttributionServerFn } from "~/features/attribution/server";
import { ensureBrowserIds } from "./browser-ids";
import { measurementPermitted, useConsent } from "./consent";
import { activatePixel, trackPageView } from "./pixel";
import { measurementQueryOptions } from "./queries";
import type { ConsentAnswer, Measurement } from "./types";

/** Before the settings have loaded a storefront measures nothing. */
const UNKNOWN: Measurement = {
  pixelId: null,
  consentRequired: false,
  consent: null,
};

export interface MeasurementState {
  pixelId: string | null;
  consentRequired: boolean;
  consent: ConsentAnswer;
  /** Whether anything may be measured right now. */
  permitted: boolean;
  /** Whether the banner still has a question outstanding. */
  askConsent: boolean;
}

/**
 * What this store measures and what this visitor allowed.
 *
 * The settings come from the commerce API through the root route's loader, so
 * they are already in the cache on the first render and the page never flickers
 * between measuring and not. The answer comes from the cookie, and changes the
 * moment the visitor gives one.
 */
export function useMeasurement(): MeasurementState {
  const { data } = useQuery(measurementQueryOptions());
  const settings = data ?? UNKNOWN;
  const consent = useConsent(settings.consent);
  const permitted = measurementPermitted(settings.consentRequired, consent);

  return {
    pixelId: settings.pixelId,
    consentRequired: settings.consentRequired,
    consent,
    permitted,
    // Asked whenever the store asks, whether or not an ad platform is connected
    // yet. Holding the banner back until there is a pixel would leave a store
    // that turned the switch on measuring nothing and never asking — the
    // behavioural tracker is held back by the same answer, and there would be
    // no way for a visitor to give it.
    askConsent: settings.consentRequired && consent === null,
  };
}

/**
 * Measurement, mounted once at the root.
 *
 * Three things happen here and all of them wait on permission: the pixel is
 * loaded and told about each page, the browser identifiers are minted so they
 * exist by the time a cart does, and — where the visitor has just answered — the
 * cart they may already have is told what they said.
 *
 * Everything runs in an effect, after paint. None of it is on the path between
 * a click and what the shopper sees, and none of it can throw: capture is
 * best-effort by construction.
 */
export function useMeasurementCapture(): void {
  const { pixelId, permitted, consent } = useMeasurement();
  const href = useRouterState({ select: (state) => state.location.href });

  React.useEffect(() => {
    if (!permitted) return;

    // Identifiers first: `_fbc` can only be read from the landing URL, and the
    // pixel loading a moment later would be too late to see it.
    ensureBrowserIds();

    // The behavioural tracker is measurement too. A store that asks before it
    // measures has to mean all of it, or the banner is decoration — so on a
    // store that asks, the script is left out of the document until the visitor
    // says yes, and injected here when they do.
    ensureTrackingScript();

    if (pixelId) {
      activatePixel(pixelId);
      trackPageView();
    }
  }, [permitted, pixelId, href]);

  // A visitor who answers the banner after they have already added something
  // needs that cart told, or the Order freezes an answer they have since
  // changed. Only a change made on this page is worth a request: the answer
  // they arrived with is already on any cart they have. Fire-and-forget — no
  // cart means no request, and a failure is nothing a shopper should hear about.
  const lastSynced = React.useRef<ConsentAnswer | undefined>(undefined);
  React.useEffect(() => {
    const previous = lastSynced.current;
    lastSynced.current = consent;
    if (previous === undefined || previous === consent || consent === null) {
      return;
    }
    const declared = readDeclaredAttribution();
    if (declared) {
      void syncAttributionServerFn({ data: declared }).catch(() => {});
    }
  }, [consent]);
}

/**
 * Adds the drop-in tracker to the page if it is not already there.
 *
 * On a store that does not ask for consent it is already in the document head,
 * put there while the page was rendered, and this does nothing. On a store that
 * does, this is how accepting starts it on the page the visitor is looking at
 * rather than on their next one.
 */
function ensureTrackingScript(): void {
  if (!trackingScript) return;
  try {
    if (document.querySelector(`script[src="${trackingScript.src}"]`)) return;
    const script = document.createElement("script");
    script.src = trackingScript.src;
    script.defer = true;
    script.dataset.key = trackingScript.key;
    script.dataset.autocapture = trackingScript.autocapture;
    document.head.appendChild(script);
  } catch {
    // Same bargain as everything else here: a lost event, never a lost page.
  }
}
