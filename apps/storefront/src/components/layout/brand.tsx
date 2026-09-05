import { storeConfig } from "~/config/store.config";

/** Fits the 56px (`h-14`) header bar with room to breathe. */
const DEFAULT_LOGO_HEIGHT = 28;

/**
 * The store's mark: the configured logo, or the store name as a wordmark when
 * no logo is set. The header and the footer both render this, so a fork that
 * sets a logo gets it everywhere the brand appears rather than in one place,
 * with the raw name still showing in the other.
 *
 * The logo's alt text is the store name rather than a knob of its own. It is
 * what the wordmark would have said, and it keeps the header's home link from
 * losing its accessible name the moment a merchant sets a logo.
 */
export function Brand() {
  const { logo, name } = storeConfig;

  if (!logo) {
    return (
      <span className="inline-block text-base font-semibold tracking-tight">
        {name}
      </span>
    );
  }

  return (
    <img
      src={logo.src}
      alt={name}
      style={{ height: logo.height ?? DEFAULT_LOGO_HEIGHT }}
      className="w-auto"
    />
  );
}
