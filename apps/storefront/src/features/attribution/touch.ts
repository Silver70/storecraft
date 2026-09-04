/**
 * Touch bookkeeping, as pure functions — the browser half of the rules the
 * backend enforces in `shared/attribution/attribution.util.ts`.
 *
 * First touch is written once and kept for the Lookback Window, so a visitor
 * who comes back a week later is still credited to the campaign that found
 * them. Last touch advances on each new attributed arrival. A direct arrival
 * (no UTM value, no external referrer) records nothing at all.
 *
 * Nothing here throws, reads storage, or talks to the network: attribution is a
 * reporting concern and must never be able to cost a sale.
 */
import { LOOKBACK_MS } from "./config";
import type {
  DeclaredAttribution,
  StoredAttribution,
  StoredTouch,
} from "./types";

/** Column widths on the commerce API — truncate here so a write never fails. */
const LIMITS = { utm: 255, referrer: 1024, landingPath: 1024 } as const;

const EMPTY: StoredAttribution = { v: 1, first: null, last: null };

export function emptyAttribution(): StoredAttribution {
  return EMPTY;
}

/** Trim, drop blanks, truncate. An over-long value degrades, never errors. */
function clip(
  value: string | null | undefined,
  max: number,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, max);
}

/**
 * The referrer, reduced to origin + path, or `undefined` when it tells us
 * nothing: same-site navigation is not an arrival, and a malformed referrer is
 * no referrer. Dropping the referrer's query string is deliberate — it belongs
 * to another site and may carry anything.
 */
function externalReferrer(raw: string, selfHost: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.host === selfHost) return undefined;
    return clip(url.origin + url.pathname, LIMITS.referrer);
  } catch {
    return undefined;
  }
}

/**
 * Reads the arrival a URL and a referrer describe, or `null` when the arrival
 * is direct. `sessionId` is carried on the touch so a later capture can tell an
 * in-session re-render from a genuine second arrival.
 */
export function readTouch(
  url: URL,
  documentReferrer: string,
  at: Date,
  sessionId?: string,
): StoredTouch | null {
  const q = url.searchParams;
  const utmSource = clip(q.get("utm_source"), LIMITS.utm);
  const utmMedium = clip(q.get("utm_medium"), LIMITS.utm);
  const utmCampaign = clip(q.get("utm_campaign"), LIMITS.utm);
  const utmContent = clip(q.get("utm_content"), LIMITS.utm);
  const referrer = externalReferrer(documentReferrer, url.host);

  if (!utmSource && !utmMedium && !utmCampaign && !utmContent && !referrer) {
    return null; // direct
  }

  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    referrer,
    landingPath: clip(url.pathname, LIMITS.landingPath),
    occurredAt: at.toISOString(),
    sig: [utmSource, utmMedium, utmCampaign, utmContent, referrer]
      .map((part) => part ?? "")
      .join("|")
      .toLowerCase(),
    sid: sessionId,
  };
}

/** True when the arrival carries campaign tags rather than only a referrer. */
function isTagged(touch: StoredTouch): boolean {
  return Boolean(
    touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.utmContent,
  );
}

/**
 * Drops touches that have fallen out of the Lookback Window.
 *
 * When the first touch expires but the last has not, the last touch *becomes*
 * the first: it is now the earliest arrival still inside the window, which is
 * exactly what First Touch means.
 */
function prune(stored: StoredAttribution, now: Date): StoredAttribution {
  const cutoff = now.getTime() - LOOKBACK_MS;
  const fresh = (touch: StoredTouch | null) => {
    if (!touch) return null;
    const at = Date.parse(touch.occurredAt);
    return Number.isFinite(at) && at >= cutoff ? touch : null;
  };

  const last = fresh(stored.last);
  const first = fresh(stored.first) ?? last;
  if (first === stored.first && last === stored.last) return stored;
  return { v: 1, first, last };
}

/**
 * Folds one arrival into what the visitor already carries.
 *
 * `changed` says whether a new touch was actually recorded — the signal that
 * the copy the commerce API holds is now behind. Expiry alone never sets it:
 * a first touch already written to a cart cannot be unwritten.
 */
export function foldArrival(
  stored: StoredAttribution,
  touch: StoredTouch | null,
  now: Date,
): { next: StoredAttribution; changed: boolean } {
  const pruned = prune(stored, now);
  if (!touch) return { next: pruned, changed: false };

  const last = pruned.last;
  if (last && last.sid === touch.sid) {
    // Same session. An untagged arrival here is the same referrer being read
    // again on a client-side route change — recording it would overwrite a
    // campaign's last touch with a bare referrer. An identical signature is
    // the same arrival seen twice.
    if (!isTagged(touch) || last.sig === touch.sig) {
      return { next: pruned, changed: false };
    }
  }

  return {
    next: { v: 1, first: pruned.first ?? touch, last: touch },
    changed: true,
  };
}

/** Strips the bookkeeping fields, leaving the shape the commerce API accepts. */
function toTouch(
  stored: StoredTouch | null,
): DeclaredAttribution["firstTouch"] {
  if (!stored) return undefined;
  const { sig: _sig, sid: _sid, ...touch } = stored;
  return touch;
}

/**
 * What to declare on cart creation. `undefined` when there is nothing worth
 * saying — an unattributed visitor sends no attribution rather than an empty
 * object.
 */
export function toDeclared(
  stored: StoredAttribution,
  identity: { visitorId?: string; sessionId?: string },
): DeclaredAttribution | undefined {
  const firstTouch = toTouch(stored.first);
  const lastTouch = toTouch(stored.last);
  if (!firstTouch && !lastTouch && !identity.visitorId && !identity.sessionId) {
    return undefined;
  }
  return {
    firstTouch,
    lastTouch,
    visitorId: identity.visitorId,
    sessionId: identity.sessionId,
  };
}
