import * as React from "react";
import { useRouterState } from "@tanstack/react-router";
import { captureArrival, readDeclaredAttribution } from "./client";
import { syncAttributionServerFn } from "./server";

/**
 * Captures attribution on landing and on every client-side navigation.
 *
 * Mounted once at the root. The capture itself is local and synchronous, and it
 * runs in an effect — after paint, off the rendering path. The only request is
 * the sync below, which fires on a genuinely new arrival (not on a page view)
 * and is not awaited by anything the shopper is looking at.
 */
export function useAttributionCapture(): void {
  const href = useRouterState({ select: (state) => state.location.href });

  React.useEffect(() => {
    if (!captureArrival()) return;

    // A new arrival on a visitor who already has a cart: advance its last touch
    // now rather than waiting for their next add, so the order carries the
    // campaign that actually closed them. No cart yet means no request.
    const declared = readDeclaredAttribution();
    if (declared) {
      void syncAttributionServerFn({ data: declared }).catch(() => {});
    }
  }, [href]);
}
