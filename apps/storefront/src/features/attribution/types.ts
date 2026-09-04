/**
 * The attribution contract, as the storefront sees it.
 *
 * Mirrors `CartAttributionInput` on the commerce API (see
 * `apps/backend/src/modules/cart/models/attribution.model.ts`). Every field is
 * optional there and every field is optional here: a storefront that knows
 * nothing sends nothing, and the order it produces is simply Unattributed.
 */

/**
 * One arrival, as the browser saw it. A touch carrying no UTM value and no
 * external referrer is *direct* — evidence of nothing — and is never recorded.
 */
export interface Touch {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  /**
   * The referring URL, reduced to origin + path. The referrer's own query
   * string is dropped: it belongs to another site and can carry anything
   * (a search term, an email address), none of which we want to store.
   */
  referrer?: string;
  /** Path the visitor landed on, without the query string. */
  landingPath?: string;
  /**
   * ISO-8601. Usually days before the cart exists — a first touch is replayed
   * from storage on the visit that finally converts.
   */
  occurredAt: string;
}

/** What the storefront declares when it creates or updates a cart. */
export interface DeclaredAttribution {
  firstTouch?: Touch;
  lastTouch?: Touch;
  /** Anonymous, random, stable across sessions. Never derived from a person. */
  visitorId?: string;
  /** Anonymous, rotates after 30 minutes idle. Shared with the tracking script. */
  sessionId?: string;
}

/** A touch as held in storage, with the bookkeeping only capture needs. */
export interface StoredTouch extends Touch {
  /**
   * Identity of the arrival — the UTM tuple plus the referrer. Lets capture
   * tell a genuinely new arrival from the same one seen again on the next
   * client-side route change.
   */
  sig: string;
  /** The session the touch was recorded in. Absent when storage is blocked. */
  sid?: string;
}

/** The whole of what the storefront persists about a visitor. */
export interface StoredAttribution {
  /** Schema version — a bump discards the old shape rather than migrating it. */
  v: 1;
  first: StoredTouch | null;
  last: StoredTouch | null;
}
