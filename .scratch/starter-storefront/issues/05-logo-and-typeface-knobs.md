# 05: Logo and typeface knobs

**What to build:** A merchant rebranding a fork sets their logo and their
typeface in config, and the storefront looks like their brand.

The fork checklist already tells them to swap the logo, and there is no logo
knob to swap. Changing the typeface currently means hunting through CSS for a
token rather than editing the file the README points at.

An unbranded fork still has to render, so the store name remains a wordmark
fallback when no logo is set.

The CSS theme tokens stay the single definition of colors and roundness. This
slice adds two knobs to the config; it does not move styling into config.

**Blocked by:** 04 (A fork that actually starts).

**Status:** ready-for-agent

- [ ] A logo can be set in the store config and appears in the header
- [ ] With no logo set, the store name renders as a wordmark and the header still looks finished
- [ ] The typeface is settable from config without editing CSS
- [ ] Both new fields pass through the config validation established in 04, failing at startup with a message naming the field
- [ ] Colors and roundness remain defined only in the theme tokens
- [ ] The store's name, description, and logo read consistently across the header, footer, and page titles, so a fork looks like one brand rather than a half-renamed template
