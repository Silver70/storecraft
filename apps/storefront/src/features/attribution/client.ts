/**
 * Attribution capture in the browser.
 *
 * Everything here is synchronous local work — parse the URL, read and write
 * `localStorage` — run from an effect after paint. Capture issues no network
 * request of its own and is on no rendering path, so it cannot delay a page,
 * a product view, or an add to cart.
 *
 * Nothing personal is collected. The identifiers are random UUIDs, the UTM
 * values come from the merchant's own ad links, the referrer is reduced to
 * origin + path, and the landing path drops its query string.
 */
import { emptyAttribution, foldArrival, readTouch, toDeclared } from "./touch";
import type { DeclaredAttribution, StoredAttribution } from "./types";

/** Where the visitor's touches live. Versioned by the `v` field inside. */
const ATTRIBUTION_KEY = "_cos_attr";

/**
 * The tracking script's own keys, read and written deliberately.
 *
 * Sharing them is what lets the backend correlate a cart with the events the
 * script sent for the same session — the fallback that gives an integrator
 * partial coverage before they pass attribution explicitly. When `ca.js` is
 * embedded it boots first (it is a deferred script, capture runs in an effect)
 * and these are already set; when it is absent we mint them under the identical
 * rule so the ids stay stable either way.
 */
const VISITOR_KEY = "_ca_vid";
const SESSION_KEY = "_ca_sid";
const SESSION_TS_KEY = "_ca_sid_ts";
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * `localStorage` throws in some private-browsing modes and is blocked outright
 * by some extensions. Falling back to memory keeps the current visit working;
 * the visitor simply looks new next time, which degrades reporting and nothing
 * else.
 *
 * Which of the two backs a page is decided once, by writing a probe. Reads and
 * writes must not disagree: a memory copy consulted whenever `localStorage`
 * answers `null` would resurrect values the visitor had just cleared.
 */
const memory: Record<string, string> = {};
let storageUsable: boolean | null = null;

function canUseStorage(): boolean {
  if (storageUsable !== null) return storageUsable;
  try {
    const probe = "_cos_probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    storageUsable = true;
  } catch {
    storageUsable = false;
  }
  return storageUsable;
}

function readKey(key: string): string | null {
  if (!canUseStorage()) return memory[key] ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory[key] ?? null;
  }
}

function writeKey(key: string, value: string): void {
  if (!canUseStorage()) {
    memory[key] = value;
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory[key] = value;
  }
}

function uuid(): string {
  const crypto = window.crypto as Crypto | undefined;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface Identity {
  visitorId: string;
  sessionId: string;
}

/**
 * The anonymous visitor and session ids, minted on first use. The session
 * rotates after 30 minutes of inactivity — the same rule `ca.js` applies, so
 * both agree on which session a page view belongs to.
 */
function identity(): Identity {
  let visitorId = readKey(VISITOR_KEY);
  if (!visitorId) {
    visitorId = uuid();
    writeKey(VISITOR_KEY, visitorId);
  }

  const now = Date.now();
  const startedAt = Number.parseInt(readKey(SESSION_TS_KEY) ?? "0", 10);
  let sessionId = readKey(SESSION_KEY);
  if (!sessionId || !startedAt || now - startedAt > SESSION_TTL_MS) {
    sessionId = uuid();
    writeKey(SESSION_KEY, sessionId);
  }
  writeKey(SESSION_TS_KEY, String(now));

  return { visitorId, sessionId };
}

function load(): StoredAttribution {
  const raw = readKey(ATTRIBUTION_KEY);
  if (!raw) return emptyAttribution();
  try {
    const parsed = JSON.parse(raw) as StoredAttribution;
    // An older or hand-edited shape is discarded rather than migrated: the
    // worst case is one visitor reported as newly arrived.
    if (parsed?.v !== 1) return emptyAttribution();
    return { v: 1, first: parsed.first ?? null, last: parsed.last ?? null };
  } catch {
    return emptyAttribution();
  }
}

function save(state: StoredAttribution): void {
  writeKey(ATTRIBUTION_KEY, JSON.stringify(state));
}

/**
 * Records the current arrival, if it is one. Returns `true` when a new touch
 * was written — the caller's cue that a cart already in flight needs telling.
 *
 * Safe to call on every route change: a re-read of the same arrival is folded
 * away, and a direct arrival records nothing.
 */
export function captureArrival(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const now = new Date();
    const { sessionId } = identity();
    const touch = readTouch(
      new URL(window.location.href),
      document.referrer,
      now,
      sessionId,
    );
    const stored = load();
    const { next, changed } = foldArrival(stored, touch, now);
    if (next !== stored) save(next);
    return changed;
  } catch {
    // Capture is best-effort by construction. A visitor never sees this fail.
    return false;
  }
}

/**
 * What to declare to the commerce API right now, or `undefined` when there is
 * nothing to say. Called from the browser at cart-creation time, so the cart
 * carries the first touch even when that touch happened days ago.
 */
export function readDeclaredAttribution(): DeclaredAttribution | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return toDeclared(load(), identity());
  } catch {
    return undefined;
  }
}
