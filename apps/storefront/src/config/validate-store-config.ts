/**
 * Startup validation for `store.config.ts`.
 *
 * The store config is the file a forking merchant edits first, so it is the
 * file they can most easily get wrong — and every value in it is read on a
 * rendering path. A bad one surfaces as a blank price, an empty header or a
 * link that goes nowhere, none of which name the field that caused it.
 * Validating at module load turns that into one startup failure that does.
 *
 * TypeScript already rejects a value of the wrong *type*; what it cannot judge
 * is whether a string is a real one. So the money settings are checked by
 * performing the exact `Intl.NumberFormat` construction `lib/money.ts`
 * performs: ISO 4217 and BCP 47 are both wider than what any given runtime
 * accepts, and `"en_US"` — plausible enough that a human writes it — is
 * rejected at the first price rather than at boot.
 */
import type {
  NavLink,
  StoreConfig,
  StoreLogo,
  StoreTypeface,
} from "./store.config";

/**
 * Thrown at module load. Reports every problem at once: a merchant filling in
 * a fresh fork usually has more than one, and fixing them one boot at a time
 * is the scavenger hunt this validation exists to end.
 */
export class StoreConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid store config in src/config/store.config.ts:\n${problems
        .map((problem) => `  • ${problem}`)
        .join("\n")}`,
    );
    this.name = "StoreConfigError";
    this.problems = problems;
  }
}

/**
 * Returns the config it was given, or throws `StoreConfigError` naming every
 * field that is wrong. Call it around the config literal so an invalid store
 * cannot start.
 */
export function validateStoreConfig(config: StoreConfig): StoreConfig {
  const problems: string[] = [];

  requireText(config.name, "name", problems);
  requireText(config.description, "description", problems);
  checkLogo(config.logo, problems);
  checkTypeface(config.typeface, problems);
  checkMoneyFormatting(config, problems);
  checkLinks(config.nav, "nav", { allowExternal: false }, problems);
  checkLinks(config.social, "social", { allowExternal: true }, problems);

  if (problems.length > 0) throw new StoreConfigError(problems);
  return config;
}

// ─── Field checks ────────────────────────────────────────────────────────────

function requireText(value: string, field: string, problems: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${field} must be a non-empty string (got ${show(value)}).`);
  }
}

/**
 * Checks something the browser will fetch: a path served from `public/`, or an
 * absolute URL. `"cdn.example.com/logo.svg"` — missing its scheme — is
 * neither, and would quietly resolve against the storefront's own origin.
 */
function requireAssetTarget(
  value: unknown,
  field: string,
  problems: string[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${field} must be a non-empty string (got ${show(value)}).`);
    return;
  }
  if (value.startsWith("/") || isAbsoluteUrl(value)) return;

  problems.push(
    `${field} must be a path starting with "/" (a file in public/) or an absolute URL (got ${show(value)}).`,
  );
}

/**
 * The logo is optional: a fork that has not got one yet renders its name as a
 * wordmark, which is a finished header rather than a missing one. What is
 * checked is the logo a merchant *did* set, since a broken `src` shows up as
 * an empty header rather than as an error.
 */
function checkLogo(logo: StoreLogo | undefined, problems: string[]): void {
  if (logo === undefined || logo === null) return;

  requireAssetTarget(logo.src, "logo.src", problems);

  const { height } = logo;
  if (height !== undefined && !(typeof height === "number" && height > 0)) {
    problems.push(
      `logo.height must be a positive number of pixels when set (got ${show(height)}). Omit it to use the default height.`,
    );
  }
}

/**
 * The typeface is the one knob that leaves this file as CSS: `family` is
 * written into a custom property on `<html>` that the theme's `--font-sans`
 * reads. So a stray `;` or brace would not fail — it would close that
 * declaration and open another one, on the element every theme token is
 * defined on. Colors and roundness are the theme's to define, and this is the
 * only field that could quietly redefine one.
 */
function checkTypeface(typeface: StoreTypeface, problems: string[]): void {
  if (typeface === null || typeof typeface !== "object") {
    problems.push(
      `typeface must be an object with a "family" (got ${show(typeface)}).`,
    );
    return;
  }

  requireText(typeface.family, "typeface.family", problems);

  if (typeof typeface.family === "string" && /[;{}]/.test(typeface.family)) {
    problems.push(
      `typeface.family must be a plain CSS font stack, with no ";" or braces (got ${show(typeface.family)}).`,
    );
  }

  if (typeface.url !== undefined) {
    requireAssetTarget(typeface.url, "typeface.url", problems);
  }
}

/**
 * Checks `currency` and `locale` by asking `Intl` — the only authority that
 * matters, since it is what renders every price.
 *
 * Each is probed alone first so that two bad values produce two messages
 * rather than one that blames whichever threw first, and the pair is then
 * probed together in the exact shape `formatMoney` uses.
 */
function checkMoneyFormatting(config: StoreConfig, problems: string[]): void {
  const localeOk = attempt(
    () => new Intl.NumberFormat(config.locale),
    (reason) =>
      problems.push(
        `locale ${show(config.locale)} is not a locale Intl accepts (${reason}). Use a BCP 47 tag such as "en-US".`,
      ),
  );

  const currencyOk = attempt(
    // Probed against a locale known to be good, so a bad locale cannot be
    // mistaken for a bad currency.
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: config.currency,
      }),
    (reason) =>
      problems.push(
        `currency ${show(config.currency)} is not a currency Intl accepts (${reason}). Use an ISO 4217 code such as "USD".`,
      ),
  );

  if (!localeOk || !currencyOk) return;

  // The construction `lib/money.ts` actually performs, formatting included.
  attempt(
    () =>
      new Intl.NumberFormat(config.locale, {
        style: "currency",
        currency: config.currency,
      }).format(0),
    (reason) =>
      problems.push(
        `currency ${show(config.currency)} cannot be formatted in locale ${show(config.locale)} (${reason}).`,
      ),
  );
}

/**
 * Nav links are paths within the storefront; social links may also be absolute
 * URLs. Both are rendered as a bare `href`, so `"twitter.com/acme"` — missing
 * its scheme — would quietly resolve against the storefront's own origin.
 */
function checkLinks(
  links: NavLink[],
  field: string,
  { allowExternal }: { allowExternal: boolean },
  problems: string[],
): void {
  if (!Array.isArray(links)) {
    problems.push(`${field} must be an array (got ${show(links)}).`);
    return;
  }

  links.forEach((link, index) => {
    const at = `${field}[${index}]`;
    requireText(link?.label, `${at}.label`, problems);

    const to = link?.to;
    if (typeof to !== "string" || to.trim() === "") {
      problems.push(`${at}.to must be a non-empty string (got ${show(to)}).`);
      return;
    }
    if (to.startsWith("/")) return;
    if (allowExternal && isAbsoluteUrl(to)) return;

    problems.push(
      allowExternal
        ? `${at}.to must be a path starting with "/" or an absolute URL (got ${show(to)}).`
        : `${at}.to must be a path within the storefront, starting with "/" (got ${show(to)}).`,
    );
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runs `probe`, reporting the reason it threw. True when it did not. */
function attempt(
  probe: () => unknown,
  onFailure: (reason: string) => void,
): boolean {
  try {
    probe();
    return true;
  } catch (err) {
    onFailure(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Quotes the offending value so an empty string reads as one. */
function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
