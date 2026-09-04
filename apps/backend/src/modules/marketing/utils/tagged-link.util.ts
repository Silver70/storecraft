/**
 * Composing the tagged URL a merchant pastes into an ad platform, as pure
 * functions.
 *
 * The generator exists so that matching is exact *by construction*: a link
 * built here carries the Campaign's own canonical tag, which the Campaign's
 * canonical rule already matches, so traffic from it is attributed without the
 * merchant authoring a rule or typing a UTM string correctly. That makes this a
 * silent-failure surface of the same kind as the matcher — a link that goes out
 * carrying the wrong `utm_campaign` does not throw, it makes a Campaign look
 * unprofitable for as long as the ad runs — so composition is a unit with no
 * database, framework or clock in it.
 *
 * Parameter values are emitted in the form `normalizeMatchValue` reduces to, and
 * the tag is emitted exactly as the Campaign holds it. Those two facts are the
 * guarantee: both sides of the comparison are already the same shape, so a
 * generated link cannot drift from the rule that claims it.
 */
import { normalizeMatchValue } from './campaign-matching.util';

/** Base for a store whose storefront URL is not configured. */
export const DEFAULT_STOREFRONT_URL = 'http://localhost:3000';

export interface TaggedLinkInput {
  /** The storefront a path destination is resolved against. */
  baseUrl: string;
  /** A path on the store — `/products/summer-tee` — or a full http(s) URL. */
  destination: string;
  /** The Campaign's canonical tag, emitted verbatim. */
  campaignTag: string;
  source: string;
  medium: string;
  content?: string | null;
}

export interface TaggedLink {
  /** The finished link, ready to paste into an ad platform. */
  url: string;
  /** Where it points, before any tagging — what the merchant chose. */
  destination: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
}

/** Which input could not be turned into part of a link. */
export type TaggedLinkProblem =
  | 'destination'
  | 'source'
  | 'medium'
  | 'content'
  | 'campaignTag';

export type TaggedLinkResult =
  | { ok: true; link: TaggedLink }
  | { ok: false; problem: TaggedLinkProblem };

/**
 * Resolves the destination the merchant chose to an absolute URL.
 *
 * Two forms are accepted and nothing else: a full `http(s)` URL, for a store on
 * its own domain, and a path on the configured storefront. Anything carrying
 * another scheme — `javascript:`, `mailto:` — is refused rather than resolved,
 * and a value that merely looks like a host (`//example.com/x`) is treated as
 * the path it literally is, so a typo can never silently retarget a campaign's
 * traffic at a domain the merchant does not own.
 *
 * Returns null when the destination cannot be made into a page of the store.
 */
export function resolveDestination(
  destination: string,
  baseUrl: string,
): URL | null {
  const trimmed = destination.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed);
    } catch {
      return null;
    }
  }

  // Any other scheme is not a page of the store.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  const path = `/${trimmed.replace(/^\/+/, '')}`;
  try {
    return new URL(path, baseUrl);
  } catch {
    return null;
  }
}

/**
 * Builds the tagged link for one Campaign.
 *
 * `utm_*` parameters already on the destination are **replaced**, not appended
 * to: destinations are routinely pasted back out of an ad platform still
 * carrying the tags of the last campaign that ran, and a URL holding two
 * `utm_campaign` values attributes to whichever one the storefront happens to
 * read first. Everything else the destination carries — its other query
 * parameters and its fragment — is preserved, because a link to a specific
 * variant or an anchored section of a page is exactly what the generator is for.
 */
export function buildTaggedLink(input: TaggedLinkInput): TaggedLinkResult {
  // Emitted verbatim: the canonical rule stores the tag the same way, and
  // matching normalizes both sides, so passing it through unchanged is what
  // keeps the link and the rule from ever drifting apart.
  const campaignTag = input.campaignTag.trim();
  if (normalizeMatchValue(campaignTag) === null) {
    return { ok: false, problem: 'campaignTag' };
  }

  const utmSource = normalizeMatchValue(input.source);
  if (utmSource === null) return { ok: false, problem: 'source' };

  const utmMedium = normalizeMatchValue(input.medium);
  if (utmMedium === null) return { ok: false, problem: 'medium' };

  // Content is optional, so an empty one is an omission rather than a mistake —
  // but a value made only of punctuation was meant to say something and did not.
  const rawContent = input.content?.trim() ?? '';
  const utmContent = rawContent === '' ? null : normalizeMatchValue(rawContent);
  if (rawContent !== '' && utmContent === null) {
    return { ok: false, problem: 'content' };
  }

  const url = resolveDestination(input.destination, input.baseUrl);
  if (url === null) return { ok: false, problem: 'destination' };

  const destination = url.toString();

  url.searchParams.set('utm_source', utmSource);
  url.searchParams.set('utm_medium', utmMedium);
  url.searchParams.set('utm_campaign', campaignTag);
  if (utmContent === null) url.searchParams.delete('utm_content');
  else url.searchParams.set('utm_content', utmContent);

  return {
    ok: true,
    link: {
      url: url.toString(),
      destination,
      utmSource,
      utmMedium,
      utmCampaign: campaignTag,
      utmContent,
    },
  };
}
