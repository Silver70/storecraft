/**
 * Meta's browser identifiers, captured in the browser and carried to the cart.
 *
 * Two values, both first-party cookies the pixel itself uses:
 *
 * - `_fbp` identifies this browser. The pixel mints it on its first load; we
 *   mint it ourselves when it has not, so that a visitor whose pixel is blocked
 *   still has one stable id on the Order the server can report against.
 * - `_fbc` identifies the ad click that brought them, and is built from the
 *   `fbclid` on the landing URL. It can only be captured on the landing page —
 *   the parameter is gone by the next navigation — which is why this ticket
 *   comes before the Purchase Events that use it.
 *
 * Everything here is gated on consent by its callers and everything here is
 * silent: a failure to read a cookie costs match quality on a report and must
 * never cost a page, a cart or a checkout.
 */
import type { BrowserIds } from "./types";

const FBP_COOKIE = "_fbp";
const FBC_COOKIE = "_fbc";

/** What Meta's own pixel uses, and what its documentation describes. */
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60;

/**
 * The domain level the cookie is written at, as Meta's format spells it. `1` is
 * a cookie on the registrable domain, which is what a host-only cookie on
 * `shop.example.com` behaves as here — we never set a `Domain` attribute, so
 * nothing below us can read it either way.
 */
const SUBDOMAIN_INDEX = 1;

/**
 * The `fbclid` this page was *landed* on, read once when the module loads.
 *
 * Held rather than re-read because capture waits for the store's settings,
 * which arrive a moment later, by which time a client-side navigation may
 * already have replaced the URL. Losing it would lose the click.
 */
const landedFbclid: string | null =
  typeof window === "undefined" ? null : readFbclid(window.location.search);

function readFbclid(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get("fbclid");
    return value && value.trim() !== "" ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Meta's click id for a click that happened at `at`. */
export function buildClickId(fbclid: string, at: number): string {
  return `fb.${SUBDOMAIN_INDEX}.${at}.${fbclid}`;
}

/** A browser id in the same shape the pixel would have minted. */
function buildBrowserId(at: number): string {
  const random = Math.floor(Math.random() * 10_000_000_000);
  return `fb.${SUBDOMAIN_INDEX}.${at}.${random}`;
}

/** One cookie's value out of a `document.cookie`-shaped string. */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key.trim() !== name) continue;
    const raw = rest.join("=").trim();
    if (raw === "") return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function write(name: string, value: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}` +
      `; SameSite=Lax${secure}`;
  } catch {
    // A blocked cookie costs this visitor's match quality and nothing else.
  }
}

/**
 * Makes sure both identifiers exist, minting what the pixel has not.
 *
 * Deliberately never overwrites: the pixel's own `_fbp` is the value it will
 * report from the browser, and replacing it would make our server's copy of the
 * same purchase look like a different person. A second landing with a new
 * `fbclid` does replace `_fbc`, because that is a newer ad click and the one
 * the platform should credit — the same rule Last Touch follows.
 *
 * Call only where measurement is permitted: these are identifiers, and a
 * visitor who declined must not be given one.
 */
export function ensureBrowserIds(): BrowserIds {
  if (typeof document === "undefined") return {};
  try {
    const now = Date.now();

    let browserId = readCookie(document.cookie, FBP_COOKIE);
    if (!browserId) {
      browserId = buildBrowserId(now);
      write(FBP_COOKIE, browserId);
    }

    let clickId = readCookie(document.cookie, FBC_COOKIE);
    if (landedFbclid && !clickId?.endsWith(`.${landedFbclid}`)) {
      clickId = buildClickId(landedFbclid, now);
      write(FBC_COOKIE, clickId);
    }

    return { metaBrowserId: browserId, metaClickId: clickId };
  } catch {
    return {};
  }
}

/**
 * What is already stored, without minting anything. This is what rides along
 * with a cart: a visitor who was never permitted to be measured carries nothing,
 * because nothing was ever written.
 */
export function readBrowserIds(): BrowserIds {
  if (typeof document === "undefined") return {};
  try {
    return {
      metaBrowserId: readCookie(document.cookie, FBP_COOKIE),
      metaClickId: readCookie(document.cookie, FBC_COOKIE),
    };
  } catch {
    return {};
  }
}
