/**
 * The ad platform's pixel, loaded from the browser.
 *
 * The pixel id is not configured here — it arrives from the commerce API, which
 * reads it off the ad account the merchant connected. So connecting switches
 * measurement on and disconnecting switches it off, both without a deploy and
 * without anyone editing this storefront.
 *
 * What it reports is browsing — pages viewed, products viewed, carts started —
 * and the purchase at the end of it. The browsing is what lets the platform build
 * audiences and gives it something to learn from before a young store has many
 * purchases, and it is what sets the browser identifiers the server-side copy of
 * the purchase is matched on.
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
function track(
  event: string,
  params?: Record<string, unknown>,
  /**
   * The platform's deduplication key. Given on an event our server reports too,
   * so the two copies of one purchase are counted once.
   */
  eventId?: string,
): void {
  if (typeof window === "undefined" || !activePixelId) return;
  try {
    if (eventId) window.fbq?.("track", event, params, { eventID: eventId });
    else window.fbq?.("track", event, params);
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

/** Purchases this browser has already reported, so a re-render does not repeat one. */
const reportedPurchases = new Set<string>();

/** An Order, as the purchase event describes it. */
export interface PurchasedOrder {
  /** The Order's id. Not its number: the server's copy carries the id. */
  id: string;
  /** Minor units, as everything monetary in this codebase is. */
  total: number;
  currency: string;
  lineItems: { sku?: string | null; quantity: number }[];
}

/**
 * The purchase, as both copies describe it — pure, so the one claim worth
 * asserting can be asserted without a browser.
 *
 * `eventId` is the Order's id and the platform's deduplication key. Everything
 * else is the figure a merchant would recognise: the total in major units,
 * because the platform's events are decimals while this codebase holds cents.
 *
 * `contents` is keyed by SKU, because that is what a merchant's product catalog
 * is keyed by at the platform. A line with no SKU is left out rather than sent
 * with an empty id: the value and the currency are the figures that matter, and a
 * catalog id matching nothing would cost the event its whole `contents`.
 */
export function purchaseEventParams(order: PurchasedOrder): {
  eventId: string;
  params: Record<string, unknown>;
} {
  return {
    eventId: order.id,
    params: {
      content_type: "product",
      contents: order.lineItems
        .filter((line) => Boolean(line.sku))
        .map((line) => ({ id: line.sku as string, quantity: line.quantity })),
      value: order.total / 100,
      currency: order.currency,
    },
  };
}

/**
 * A purchase completed.
 *
 * The one event with a second copy: the commerce engine reports every paid Order
 * from its own server, and that copy is the one that survives an ad blocker. Both
 * carry **the Order's id as the event id**, which is the entire reason the
 * platform counts one purchase rather than two — so this value is the Order's id
 * and nothing else, not the order number and not something generated here.
 *
 * Called once per Order per page load. The set below covers a re-render and the
 * confirmation page's own polling; a visitor who reloads the page reports it
 * again, and that is safe for the same reason the server's copy is — the platform
 * deduplicates on the id, and it is the same id.
 *
 * Nothing is remembered until something was actually reported. Effects run from
 * the leaf up, so the confirmation page can reach here on its first commit a beat
 * before the root has loaded the pixel — and an Order marked reported by a call
 * that went nowhere would be the one purchase the browser never sends.
 */
export function trackPurchase(order: PurchasedOrder): void {
  if (reportedPurchases.has(order.id) || !activePixelId) return;
  reportedPurchases.add(order.id);

  const { eventId, params } = purchaseEventParams(order);
  track("Purchase", params, eventId);
}
