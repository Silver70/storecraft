/**
 * ◄ TEMPLATE KNOB — edit this file to rebrand the storefront.
 *
 * Brand-level configuration: store identity, currency/locale, and navigation.
 * Nothing brand-specific should be hardcoded in components — it belongs here
 * (or in the CSS theme tokens / `home-sections.ts`).
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

export interface StoreConfig {
  /** Display name — used in the header, footer, and document titles. */
  name: string;
  /** One-line description for SEO meta + the footer tagline. */
  description: string;
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
  currency: "USD",
  locale: "en-US",
  nav: [{ label: "Shop All", to: "/products" }],
  social: [],
});
