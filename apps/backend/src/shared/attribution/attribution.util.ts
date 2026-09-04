/**
 * Touch bookkeeping, as pure functions.
 *
 * The rules, from the attribution spec: First Touch is the earliest non-direct
 * Touch and is written once — never overwritten. Last Touch is the latest
 * non-direct Touch and advances as new ones arrive, but never regresses to an
 * older one. A direct Touch (no UTM value, no referrer) changes neither.
 *
 * Nothing here touches a database or throws: a reporting concern must never be
 * able to cost a sale, so every input shape has a defined, boring outcome.
 */
import { ATTRIBUTION_LIMITS } from '../database/schema';
import type {
  AttributionPatch,
  AttributionSnapshot,
  DeclaredAttributionInput,
  TouchInput,
} from './attribution.types';

/** A Touch with its values already trimmed, truncated, and time-stamped. */
interface NormalizedTouch {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrer: string | null;
  landingPath: string | null;
  occurredAt: Date;
}

/** An unattributed snapshot — the state of every cart and order by default. */
export function emptyAttribution(): AttributionSnapshot {
  return {
    attributionSource: 'none',
    visitorId: null,
    sessionId: null,
    firstTouchUtmSource: null,
    firstTouchUtmMedium: null,
    firstTouchUtmCampaign: null,
    firstTouchUtmContent: null,
    firstTouchReferrer: null,
    firstTouchLandingPath: null,
    firstTouchAt: null,
    lastTouchUtmSource: null,
    lastTouchUtmMedium: null,
    lastTouchUtmCampaign: null,
    lastTouchUtmContent: null,
    lastTouchReferrer: null,
    lastTouchLandingPath: null,
    lastTouchAt: null,
  };
}

/**
 * Lifts the attribution column group out of a cart or order row, dropping
 * everything else. This is what gets copied onto an order at checkout.
 */
export function pickAttribution(
  row: Partial<AttributionSnapshot> | null | undefined,
): AttributionSnapshot {
  if (!row) return emptyAttribution();

  return {
    attributionSource: row.attributionSource ?? 'none',
    visitorId: row.visitorId ?? null,
    sessionId: row.sessionId ?? null,
    firstTouchUtmSource: row.firstTouchUtmSource ?? null,
    firstTouchUtmMedium: row.firstTouchUtmMedium ?? null,
    firstTouchUtmCampaign: row.firstTouchUtmCampaign ?? null,
    firstTouchUtmContent: row.firstTouchUtmContent ?? null,
    firstTouchReferrer: row.firstTouchReferrer ?? null,
    firstTouchLandingPath: row.firstTouchLandingPath ?? null,
    firstTouchAt: row.firstTouchAt ?? null,
    lastTouchUtmSource: row.lastTouchUtmSource ?? null,
    lastTouchUtmMedium: row.lastTouchUtmMedium ?? null,
    lastTouchUtmCampaign: row.lastTouchUtmCampaign ?? null,
    lastTouchUtmContent: row.lastTouchUtmContent ?? null,
    lastTouchReferrer: row.lastTouchReferrer ?? null,
    lastTouchLandingPath: row.lastTouchLandingPath ?? null,
    lastTouchAt: row.lastTouchAt ?? null,
  };
}

/**
 * Folds a storefront's declaration into the attribution already on a cart,
 * returning only the columns that change.
 *
 * `current` is the cart's existing group (null for a cart being created). The
 * two touches are applied in order, so a caller re-sending a stored First Touch
 * alongside a fresh Last Touch gets exactly what it means: the First Touch is
 * left alone and the Last Touch advances.
 *
 * Returns an empty patch when there is nothing to record, which keeps a
 * declaration of nothing from being a write.
 */
export function applyDeclaredAttribution(
  current: Partial<AttributionSnapshot> | null | undefined,
  input: DeclaredAttributionInput | null | undefined,
  now: Date = new Date(),
): AttributionPatch {
  return applyTouches(current, input, 'declared', now);
}

/**
 * The same fold, for touches the system *inferred* from the tracked event log
 * because the storefront declared none — marking the result `correlated` so a
 * merchant can tell a guess from a fact and judge how much to trust it.
 *
 * A backstop, never the primary source: the event stream it reads can be
 * blocked by the client and is eventually deleted by the retention purge, which
 * is precisely why ADR-0001 makes the declared snapshot authoritative. Callers
 * apply this only to a cart that declared nothing.
 */
export function applyCorrelatedAttribution(
  current: Partial<AttributionSnapshot> | null | undefined,
  input: DeclaredAttributionInput | null | undefined,
  now: Date = new Date(),
): AttributionPatch {
  return applyTouches(current, input, 'correlated', now);
}

/**
 * The fold itself. Identical for both sources — where a touch came from changes
 * only the marker written alongside it, never which touch wins.
 */
function applyTouches(
  current: Partial<AttributionSnapshot> | null | undefined,
  input: DeclaredAttributionInput | null | undefined,
  source: 'declared' | 'correlated',
  now: Date,
): AttributionPatch {
  if (!input) return {};

  const patch: AttributionPatch = {};

  // Visitor and session are last-write-wins: the visitor id is stable, and the
  // session id must be the current one for the correlation fallback to work.
  const visitorId = normalizeText(
    input.visitorId,
    ATTRIBUTION_LIMITS.visitorId,
  );
  if (visitorId) patch.visitorId = visitorId;
  const sessionId = normalizeText(
    input.sessionId,
    ATTRIBUTION_LIMITS.sessionId,
  );
  if (sessionId) patch.sessionId = sessionId;

  let hasFirstTouch = current?.firstTouchAt != null;
  let lastTouchAt = current?.lastTouchAt ?? null;

  for (const raw of [input.firstTouch, input.lastTouch]) {
    const touch = normalizeTouch(raw, now);
    if (!touch || !isAttributedTouch(touch)) continue;

    if (!hasFirstTouch) {
      patch.firstTouchUtmSource = touch.utmSource;
      patch.firstTouchUtmMedium = touch.utmMedium;
      patch.firstTouchUtmCampaign = touch.utmCampaign;
      patch.firstTouchUtmContent = touch.utmContent;
      patch.firstTouchReferrer = touch.referrer;
      patch.firstTouchLandingPath = touch.landingPath;
      patch.firstTouchAt = touch.occurredAt;
      hasFirstTouch = true;
    }

    // Only ever forward in time. Without this a storefront re-sending its
    // stored First Touch on a later visit would drag Last Touch backwards onto
    // the older arrival.
    if (lastTouchAt === null || touch.occurredAt >= lastTouchAt) {
      patch.lastTouchUtmSource = touch.utmSource;
      patch.lastTouchUtmMedium = touch.utmMedium;
      patch.lastTouchUtmCampaign = touch.utmCampaign;
      patch.lastTouchUtmContent = touch.utmContent;
      patch.lastTouchReferrer = touch.referrer;
      patch.lastTouchLandingPath = touch.landingPath;
      patch.lastTouchAt = touch.occurredAt;
      lastTouchAt = touch.occurredAt;
    }

    patch.attributionSource = source;
  }

  return patch;
}

/**
 * Whether a Touch is evidence of anything. A UTM value or a referrer means the
 * visitor came from somewhere; a bare landing path means they arrived direct.
 * Whether a referrer is the store's own domain is a matching-rule concern, not
 * one this layer can judge.
 */
function isAttributedTouch(touch: NormalizedTouch): boolean {
  return (
    touch.utmSource !== null ||
    touch.utmMedium !== null ||
    touch.utmCampaign !== null ||
    touch.utmContent !== null ||
    touch.referrer !== null
  );
}

function normalizeTouch(
  touch: TouchInput | null | undefined,
  now: Date,
): NormalizedTouch | null {
  if (!touch) return null;
  return {
    utmSource: normalizeText(touch.utmSource, ATTRIBUTION_LIMITS.utm),
    utmMedium: normalizeText(touch.utmMedium, ATTRIBUTION_LIMITS.utm),
    utmCampaign: normalizeText(touch.utmCampaign, ATTRIBUTION_LIMITS.utm),
    utmContent: normalizeText(touch.utmContent, ATTRIBUTION_LIMITS.utm),
    referrer: normalizeText(touch.referrer, ATTRIBUTION_LIMITS.referrer),
    landingPath: normalizeText(
      touch.landingPath,
      ATTRIBUTION_LIMITS.landingPath,
    ),
    occurredAt: normalizeTimestamp(touch.occurredAt, now),
  };
}

/**
 * Trims, drops blanks, and truncates to the column width — an over-long
 * referrer degrades to a truncated one rather than failing the write it rides
 * along with.
 */
function normalizeText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, maxLength);
}

/** A missing, unparseable, or future timestamp becomes now. */
function normalizeTimestamp(value: Date | null | undefined, now: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return now;
  return value.getTime() > now.getTime() ? now : value;
}
