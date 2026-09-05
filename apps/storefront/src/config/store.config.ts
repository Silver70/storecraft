/**
 * ◄ TEMPLATE KNOB — edit this file to rebrand the storefront.
 *
 * Brand-level configuration: store identity, logo, typeface, currency/locale,
 * and navigation. Nothing brand-specific should be hardcoded in components —
 * it belongs here (or in the CSS theme tokens / `home-sections.ts`).
 *
 * Every value is validated when the app starts. A typo fails on boot with a
 * message naming the field, rather than showing up later as a blank price.
 */
import { validateStoreConfig } from "./validate-store-config";

export interface NavLink {
  label: string;
  /** Absolute path within the storefront (e.g. "/products"). */
  to: string;
}

/** The brand mark shown in the header and the footer. */
export interface StoreLogo {
  /** A file in `public/` (e.g. "/logo.svg") or an absolute URL. */
  src: string;
  /**
   * Rendered height in pixels; the width follows the image's aspect ratio.
   * The header bar is 56px tall, so much above ~36 will crowd it.
   * Defaults to 28.
   */
  height?: number;
}

/** The typeface the whole storefront is set in. */
export interface StoreTypeface {
  /**
   * CSS font stack. End it with a generic family (`sans-serif`) so there is
   * something readable while a webfont loads, or if it never does.
   */
  family: string;
  /**
   * Stylesheet that loads the font — a Google Fonts URL, or your own CSS in
   * `public/`. Omit it for fonts already on the device, as the default stack
   * below is.
   */
  url?: string;
}

export interface StoreConfig {
  /** Display name — used in the header, footer, and document titles. */
  name: string;
  /** One-line description for SEO meta + the footer tagline. */
  description: string;
  /** Brand mark. Omit it and `name` renders as a wordmark instead. */
  logo?: StoreLogo;
  /** Typeface for every surface. Overrides the fallback stack in `app.css`. */
  typeface: StoreTypeface;
  /** ISO 4217 currency code. Money is formatted with this by default. */
  currency: string;
  /** BCP 47 locale used for Intl money/number formatting. */
  locale: string;
  /** Primary navigation links rendered in the header. */
  nav: NavLink[];
  /** Footer / social links (optional). Paths or absolute URLs. */
  social: NavLink[];
}

export const storeConfig: StoreConfig = validateStoreConfig({
  name: "Acme",
  description: "Thoughtfully made goods for everyday life.",

  // Drop your logo in `public/` and point at it. Left unset, the store name
  // renders as a wordmark, which is why an unbranded fork still has a header.
  // logo: { src: "/logo.svg", height: 28 },

  typeface: {
    family:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    // url: "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap",
  },

  currency: "USD",
  locale: "en-US",
  nav: [{ label: "Shop All", to: "/products" }],
  social: [],
});
