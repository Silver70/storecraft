/**
 * Where a Store's storefront lives, and how to build a link into it.
 *
 * The engine is headless, so it does not know the shape of anyone's URLs — the
 * storefront is somebody else's deployment. Two Store settings close that gap:
 * the address the storefront is served at, and the shape of its product page
 * paths. The Starter Storefront serves `/products/{slug}`, which is the
 * default, but a merchant who forked it and moved the route must be able to say
 * so rather than being silently wrong.
 *
 * Every function here is pure and takes the two settings as data, so the rules
 * can be tested without a database. The one rule worth stating out loud: a
 * destination must land on the Store's own storefront. That is where our
 * capture script reads the link tags, so a link pointing anywhere else is a
 * campaign that cannot be measured. It is refused here rather than discovered
 * later, when the money has already been spent.
 */

/** The placeholder a product path pattern must carry. */
export const PRODUCT_SLUG_PLACEHOLDER = '{slug}';

/** What the Starter Storefront serves, and what a Store starts with. */
export const DEFAULT_PRODUCT_PATH_PATTERN = '/products/{slug}';

/** The two Store settings this module reads, and nothing else. */
export type StorefrontSettings = {
  storefrontUrl: string | null;
  productPathPattern: string | null;
};

/**
 * Where a link points. A product, the all-products page, the home page, or a
 * path the merchant typed — and nothing outside the Store's own storefront.
 */
export type StorefrontDestination =
  | { kind: 'product'; slug: string }
  | { kind: 'all_products' }
  | { kind: 'home' }
  | { kind: 'custom'; path: string };

/**
 * A setting that cannot be stored, or a destination that cannot be built.
 * Carries a merchant-readable message; callers at an HTTP edge map it to a 400.
 */
export class StorefrontUrlError extends Error {}

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Validates a storefront URL and returns it in the one form we store.
 *
 * Absolute `http`/`https` only, and no query or fragment: a base carrying
 * either would collide with the `utm_*` parameters the ad platform appends at
 * click time, producing a link that 404s or loses its tags. The trailing slash
 * is stripped so that two merchants who typed the same address with and
 * without one resolve to the same links.
 */
export function normalizeStorefrontUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new StorefrontUrlError('Storefront URL cannot be empty.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new StorefrontUrlError(
      `“${trimmed}” is not a valid URL. Enter the full address your storefront is served at, including https://.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new StorefrontUrlError(
      `Storefront URL must start with http:// or https:// — “${url.protocol}” is not a web address.`,
    );
  }
  if (url.search) {
    throw new StorefrontUrlError(
      'Storefront URL cannot carry a query string. Ad links add their own tracking parameters, which would collide with it.',
    );
  }
  if (url.hash) {
    throw new StorefrontUrlError(
      'Storefront URL cannot carry a #fragment — it never reaches the server.',
    );
  }

  // `URL` already lowercases the host and fills in a bare origin's path as "/".
  return url.origin + stripTrailingSlash(url.pathname);
}

/**
 * Validates a product path pattern and returns it in the one form we store.
 *
 * It must carry `{slug}`, because a pattern without it produces the same URL
 * for every product — a whole campaign pointing at one page, which reads as a
 * catastrophic conversion rate rather than as the misconfiguration it is.
 */
export function normalizeProductPathPattern(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new StorefrontUrlError('Product path cannot be empty.');
  }
  if (!trimmed.includes(PRODUCT_SLUG_PLACEHOLDER)) {
    throw new StorefrontUrlError(
      `Product path must contain ${PRODUCT_SLUG_PLACEHOLDER}, the placeholder we replace with each product's slug — for example ${DEFAULT_PRODUCT_PATH_PATTERN}.`,
    );
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new StorefrontUrlError(
      'Product path cannot carry a query string or a #fragment. Ad links add their own tracking parameters, which would collide with it.',
    );
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    throw new StorefrontUrlError(
      'Product path is a path on your storefront, not a full URL — start it with a slash, for example /products/{slug}.',
    );
  }

  return normalizePath(trimmed);
}

// ─── Resolving ────────────────────────────────────────────────────────────────

/**
 * The full URL a destination points at, on this Store's own storefront.
 *
 * Throws when the storefront URL is unset, because there is no honest answer —
 * every caller that builds an ad link needs this to be a hard stop rather than
 * a plausible-looking link to nowhere.
 */
export function resolveStorefrontUrl(
  settings: StorefrontSettings,
  destination: StorefrontDestination,
): string {
  const base = requireStorefrontUrl(settings);

  switch (destination.kind) {
    case 'product':
      return join(base, productPath(settings, destination.slug));
    case 'all_products':
      return join(base, allProductsPath(settings));
    case 'home':
      return join(base, '/');
    case 'custom':
      return resolveCustomPath(settings, destination.path);
  }
}

/** The path a single product is served at, with the slug substituted in. */
export function productPath(
  settings: StorefrontSettings,
  slug: string,
): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    throw new StorefrontUrlError('Product has no slug to build a link from.');
  }
  return pattern(settings).replaceAll(
    PRODUCT_SLUG_PLACEHOLDER,
    encodeURIComponent(trimmed),
  );
}

/**
 * The path the all-products page is served at, read off the product pattern.
 *
 * It is the pattern with the placeholder's own segment and everything after it
 * removed: `/products/{slug}` → `/products`, `/shop/p/{slug}` → `/shop/p`. A
 * merchant who moved their product route almost always moved the listing with
 * it, so this follows rather than asking for a third setting that would sit
 * wrong by default.
 */
export function allProductsPath(settings: StorefrontSettings): string {
  const segments = pattern(settings).split('/');
  const placeholderAt = segments.findIndex((s) =>
    s.includes(PRODUCT_SLUG_PLACEHOLDER),
  );
  const kept = segments.slice(0, placeholderAt).join('/');
  return kept === '' ? '/' : kept;
}

/**
 * A path the merchant typed, checked against the Store's own storefront.
 *
 * A relative path is taken as-is. An absolute URL is allowed only when it
 * resolves onto this storefront — same origin, and under its base path when it
 * has one — and refused with the reason when it does not.
 */
export function resolveCustomPath(
  settings: StorefrontSettings,
  input: string,
): string {
  const base = requireStorefrontUrl(settings);
  const trimmed = input.trim();
  if (!trimmed) {
    throw new StorefrontUrlError('Destination path cannot be empty.');
  }

  const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  if (!isAbsolute) {
    return join(base, ensureLeadingSlash(trimmed));
  }

  let candidate: URL;
  try {
    candidate = new URL(trimmed);
  } catch {
    throw new StorefrontUrlError(`“${trimmed}” is not a valid URL.`);
  }

  const baseUrl = new URL(base);
  if (candidate.origin !== baseUrl.origin) {
    throw new StorefrontUrlError(
      `An ad must send people to your own storefront (${base}), not to ${candidate.origin}. We can only measure a campaign whose visitors land on your store.`,
    );
  }

  const basePath = stripTrailingSlash(baseUrl.pathname);
  if (basePath && !isUnderPath(candidate.pathname, basePath)) {
    throw new StorefrontUrlError(
      `An ad must send people to your own storefront (${base}), and “${candidate.pathname}” is outside it.`,
    );
  }

  return (
    candidate.origin + candidate.pathname + candidate.search + candidate.hash
  );
}

// ─── Readiness ────────────────────────────────────────────────────────────────

/**
 * Whether links can be built yet, and what is missing when they cannot.
 *
 * Both settings are optional until something needs them. The admin reads this
 * to say what will not work while they are unset, rather than letting a
 * merchant discover it on a form they cannot submit.
 */
export function storefrontReadiness(settings: StorefrontSettings): {
  canBuildLinks: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!settings.storefrontUrl?.trim()) missing.push('storefrontUrl');
  return { canBuildLinks: missing.length === 0, missing };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function requireStorefrontUrl(settings: StorefrontSettings): string {
  const url = settings.storefrontUrl?.trim();
  if (!url) {
    throw new StorefrontUrlError(
      "This store has no storefront URL set, so there is no address to send an ad's clicks to. Add one in Settings › General.",
    );
  }
  return stripTrailingSlash(url);
}

function pattern(settings: StorefrontSettings): string {
  const raw = settings.productPathPattern?.trim();
  return normalizePath(raw ? raw : DEFAULT_PRODUCT_PATH_PATTERN);
}

/**
 * A path with exactly one leading slash and no trailing one, so that the same
 * pattern typed with or without either resolves to the same link.
 */
function normalizePath(value: string): string {
  return ensureLeadingSlash(stripTrailingSlash(value));
}

/**
 * Base and path into one URL, with exactly one slash between them regardless of
 * how either was typed. The base's own path is kept, so a storefront served
 * from a subdirectory still resolves.
 */
function join(base: string, path: string): string {
  const left = stripTrailingSlash(base);
  const right = ensureLeadingSlash(path);
  return right === '/' ? `${left}/` : `${left}${right}`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

/** True when `path` is `under` itself or sits beneath it as a whole segment. */
function isUnderPath(path: string, under: string): boolean {
  return path === under || path.startsWith(`${under}/`);
}
