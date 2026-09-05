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

**Status:** resolved

- [x] A logo can be set in the store config and appears in the header
- [x] With no logo set, the store name renders as a wordmark and the header still looks finished
- [x] The typeface is settable from config without editing CSS
- [x] Both new fields pass through the config validation established in 04, failing at startup with a message naming the field
- [x] Colors and roundness remain defined only in the theme tokens
- [x] The store's name, description, and logo read consistently across the header, footer, and page titles, so a fork looks like one brand rather than a half-renamed template

## Comments

Implemented 2026-09-05.

Two fields on `store.config.ts`. `logo` is optional — `{ src, height? }`, a
file in `public/` or an absolute URL — and ships commented out, so a fresh fork
sees the shape without having to invent it. `typeface` is required:
`{ family, url? }`, where `family` is a CSS font stack and `url` is the
stylesheet that loads it. The `url` is there because without it the knob does
not do what the ticket asks: a merchant who sets `family: "Inter"` and has no
way to load Inter gets a fallback, and is back to editing CSS to add the font
link — the hunt this slice exists to end.

The typeface reaches the CSS as a custom property rather than a value. The
theme's `--font-sans` is now `var(--typeface, ui-sans-serif, system-ui,
sans-serif)` and `__root.tsx` sets `--typeface` on `<html>` from the config, so
`store.config.ts` is the only file a font change touches. The stack left in the
CSS is a floor, not a second definition — it renders a document that somehow
has no config value rather than restating one. `--primary`, `--radius` and
every color are untouched and remain theme tokens; the README's checklist now
says so, and stops naming `--font-sans` as something to edit there.

`family` is the one field that becomes CSS text, so it is checked for `;` and
braces. React escapes quotes into the `style` attribute but not semicolons, so
`"Inter; --primary: red"` would not fail — it would close that declaration and
open another one on the element every theme token is defined on. That is a
silent way to violate "colors stay in the tokens", and it is now a boot error.
`logo.src` and `typeface.url` go through one `requireAssetTarget` check, the
same rule the social links already use: a path or an absolute URL, because
`"cdn.example.com/logo.svg"` resolves against the storefront's own origin.
`logo.height` must be a positive number.

A `Brand` component holds the logo-or-wordmark choice, and the header and the
footer both render it. Header-only would have been enough for the checkbox and
would have left exactly the half-renamed look the last criterion names: a
branded header above a footer still showing the raw store name. The logo's alt
text is the store name rather than a knob of its own — it is what the wordmark
would have said, and it keeps the header's home link from losing its accessible
name the moment a logo is set. The wordmark keeps the header's existing type
(`text-base font-semibold tracking-tight`); the footer's name moves up from
`text-sm` to match it, which is the only visual change to an unbranded fork.

Twelve new specs in `src/config/validate-store-config.spec.ts` (64 in the app):
a config with no logo passes, a `public/` path and an absolute URL pass, a
schemeless `src` and a blank `src` and a zero or negative `height` are each
named, a blank `family` and a `family` carrying its own declaration are
rejected, and a Google Fonts URL, self-hosted font CSS, and a schemeless `url`
behave as specified. Per the stage's testing decision, the components
themselves are verified by running the app rather than rendered in a test.

Verified by running it. With the shipped config the header and footer both
render `<span …>Acme</span>` and the document carries the default stack as
`--typeface`, with no font stylesheet in `<head>`. With
`logo: { src: "/logo.svg", height: 24 }` and an Inter typeface, both surfaces
render `<img src="/logo.svg" alt="Acme" style="height:24px" class="w-auto">`,
`<html>` carries `--typeface:"Inter", …`, and the Google Fonts stylesheet is in
`<head>`. The built CSS resolves as intended: `--font-sans:
var(--typeface, …)`, `html{…font-family:var(--typeface, …)}`, and
`.font-heading{font-family:var(--font-sans)}`. Each of a schemeless `logo.src`,
a zero `logo.height`, a `family` with a `;`, and a schemeless `typeface.url`
fails at boot with a message naming the field. `npm test` (64) and
`npm run build` (`tsc --noEmit` included) pass.

One thing observed and not done: every page still has the same `<title>` — the
store name — because the root route is the only one that sets a head. That is
consistent across the app, which is what this ticket asked for, but it is not
useful; per-page titles are worth a ticket of their own rather than a silent
addition here.
