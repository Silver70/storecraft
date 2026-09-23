/**
 * The visitor's answer to the consent banner, and where it lives.
 *
 * A cookie rather than `localStorage`, and that is the whole design: the answer
 * has to be readable by the server that renders the page — so that a visitor who
 * declined never receives the pixel in their HTML at all, rather than receiving
 * it and having script decide not to run it — and by the checkout path, so that
 * the Order carries what the visitor actually agreed to. `localStorage` is
 * invisible to both.
 *
 * It is a first-party cookie carrying one of two words. It is not an identifier,
 * it is not sent anywhere except back to this storefront, and it is the one
 * cookie a visitor who declined everything still gets — because the alternative
 * is asking them again on every page.
 */
import * as React from "react";
import type { ConsentAnswer } from "./types";

export const CONSENT_COOKIE = "cos_consent";

/** A year: long enough that answering feels final, short enough to be re-asked. */
const CONSENT_MAX_AGE = 365 * 24 * 60 * 60;

/** The two answers, and nothing else. Anything unrecognised is no answer. */
export function parseConsent(value: string | null | undefined): ConsentAnswer {
  if (value === "granted" || value === "denied") return value;
  return null;
}

/** The answer in a cookie header or `document.cookie`, or null. */
export function readConsentFrom(
  cookieHeader: string | null | undefined,
): ConsentAnswer {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name.trim() !== CONSENT_COOKIE) continue;
    try {
      return parseConsent(decodeURIComponent(rest.join("=").trim()));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Whether measuring is allowed right now. The store that does not ask always
 * allows; the store that asks allows only an explicit yes. Both halves matter:
 * treating "not answered yet" as yes would make the banner decorative.
 */
export function measurementPermitted(
  consentRequired: boolean,
  consent: ConsentAnswer,
): boolean {
  return !consentRequired || consent === "granted";
}

// ─── The browser's copy ──────────────────────────────────────────────────────

/**
 * Cookies can be blocked as thoroughly as `localStorage` can. When the write
 * does not survive, the answer is held for the page instead: the visitor is
 * asked again on their next one, which is the correct failure — we would rather
 * ask twice than measure someone who said no.
 */
let memory: ConsentAnswer = null;
const listeners = new Set<() => void>();

function readBrowserConsent(): ConsentAnswer {
  if (typeof document === "undefined") return null;
  try {
    return readConsentFrom(document.cookie) ?? memory;
  } catch {
    return memory;
  }
}

/** Records the visitor's answer and tells every hook watching. */
export function writeConsent(answer: Exclude<ConsentAnswer, null>): void {
  memory = answer;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${CONSENT_COOKIE}=${answer}; Path=/; Max-Age=${CONSENT_MAX_AGE}` +
      `; SameSite=Lax${secure}`;
  } catch {
    // Held in memory for this page; asked again on the next.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The current answer, re-rendering whatever reads it the moment it changes —
 * so accepting starts measurement on the page the visitor is already on, rather
 * than on their next one.
 *
 * `serverAnswer` is what the request's cookie said, which is what the server
 * rendered against; returning it as the server snapshot is what keeps hydration
 * from disagreeing with the HTML.
 */
export function useConsent(serverAnswer: ConsentAnswer): ConsentAnswer {
  return React.useSyncExternalStore(
    subscribe,
    readBrowserConsent,
    () => serverAnswer,
  );
}
