/**
 * The ad platform's pixel, loaded from the browser.
 *
 * The pixel id is not configured here — it arrives from the commerce API, which
 * reads it off the ad account the merchant connected. So connecting switches
 * measurement on and disconnecting switches it off, both without a deploy and
 * without anyone editing this storefront.
 *
 * What it reports is browsing: pages viewed, products viewed, carts started.
 * That is what lets the platform build audiences and gives it something to learn
 * from before a young store has many purchases — and it is what sets the browser
 * identifiers the server-side purchases are matched on.
 *
 * Every function here is a no-op until the pixel has been activated, and every
 * one of them swallows its own failures. Reporting must never be able to cost a
 * sale, so a blocked script, a refused cookie or a vendor outage shows up as a
 * gap in a report and never as anything a shopper can see.
 */

const SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

type Fbq = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: unknown;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

/** The pixel currently initialised, so activating twice does nothing twice. */
let activePixelId: string | null = null;

/**
 * Installs the queue the pixel's own snippet installs, so that calls made
 * before the script finishes downloading are replayed rather than lost. This is
 * the reason a `ViewContent` fired on a fast click still arrives.
 */
function installQueue(): Fbq {
  const existing = window.fbq;
  if (existing) return existing;

  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.push = fbq;

  window.fbq = fbq;
  window._fbq ??= fbq;
  return fbq;
}

function loadScript(): void {
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = SCRIPT_SRC;
  document.head.appendChild(script);
}

/**
 * Loads and initialises the pixel. Safe to call on every render: the second
 * call for the same pixel does nothing, and a *different* pixel id — a merchant
 * who reconnected to another ad account — initialises alongside the first
 * rather than replacing it, because the platform's own API has no un-init.
 */
export function activatePixel(pixelId: string): void {
  if (typeof window === "undefined" || !pixelId) return;
  if (activePixelId === pixelId) return;
  try {
    const fbq = installQueue();
    loadScript();
    fbq("init", pixelId);
    activePixelId = pixelId;
  } catch {
    // An extension that replaced `window.fbq` with something hostile, or a CSP
    // that refuses the script. Either way: no measurement, no error.
  }
}

/** Whether anything is listening. Everything below is a no-op when nothing is. */
function track(event: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !activePixelId) return;
  try {
    window.fbq?.("track", event, params);
  } catch {
    // Reporting is evidence, never a dependency.
  }
}

/** A page was viewed. Fired on landing and on every client-side navigation. */
export function trackPageView(): void {
  track("PageView");
}

/** A product page was opened. */
export function trackViewContent(product: {
  id: string;
  name: string;
  /** Minor units, as everything monetary in this codebase is. */
  price: number;
  currency: string;
}): void {
  track("ViewContent", {
    content_type: "product",
    content_ids: [product.id],
    content_name: product.name,
    value: product.price / 100,
    currency: product.currency,
  });
}

/** A cart was started, or added to. */
export function trackAddToCart(line: {
  variantId: string;
  productName: string;
  quantity: number;
  /** Minor units. */
  unitPrice: number;
  currency: string;
}): void {
  track("AddToCart", {
    content_type: "product",
    content_ids: [line.variantId],
    content_name: line.productName,
    contents: [{ id: line.variantId, quantity: line.quantity }],
    value: (line.unitPrice * line.quantity) / 100,
    currency: line.currency,
  });
}
