# 03: A Store knows where its storefront lives

**What to build:** A Store gains the address its storefront is served at, and
the shape of its product page paths. Without these, nothing here can build the
link an ad points at.

The system is headless, so the URL shape belongs to whoever built the storefront.
The Starter Storefront serves products at `/products/{slug}`, which is the
default, but a merchant who forked it and changed the routing must be able to say
so rather than being silently wrong.

An ad's destination must land on the Store's own storefront, because that is the
only place the capture script reads the link tags. A destination pointing
anywhere else is a campaign that cannot be measured, so it is refused here rather
than discovered later.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A merchant sets their Store's storefront URL in settings, and it is
      validated as an absolute `http`/`https` URL with no query or fragment
- [x] A merchant sets a product path pattern, defaulting to `/products/{slug}`
      and required to contain the slug placeholder
- [x] Given a product, the system produces its full storefront URL
- [x] It produces the URL of the all-products page and of the home page
- [x] It accepts a custom path and refuses anything not on the Store's own
      storefront, with a message saying why
- [x] The resolved URL is stable regardless of trailing slashes in either
      setting
- [x] Both settings are optional until something needs them, and the admin says
      what will not work while they are unset
- [x] Writing them requires the same permission as other Store settings

## Comments

Done. Backend `tsc`, `nest build`, `npm test` (202 unit specs, 31 of them new)
and the frontend build are green, and `eslint` is clean over everything
touched. `npm run test:e2e` has 125 passing and one failure —
`inline-edit.e2e-spec.ts`, the same assertion tickets 01 and 02 both recorded,
which asserts an exact object that has since gained `canEditContent`. It does
not touch stores.

The rules live in one pure module, `shared/utils/storefront-url.util.ts`, which
takes the two settings as data and never reads a database. `StoreService` is
the only thing that calls it: on write it normalizes and stores, and on read it
resolves a Destination, mapping `StorefrontUrlError` to a 400 so a merchant
gets the reason rather than a stack trace.

Judgement calls not on the checklist:

**`product_path_pattern` is `NOT NULL DEFAULT '/products/{slug}'`, not
nullable.** "Optional until something needs it" is then true of the storefront
URL alone, which is the honest shape: a Store always has _some_ product route,
and the Starter Storefront's is the right guess. Sending an empty string
restores the default rather than storing nothing. `storefront_url` is nullable
and an empty string clears it, because there is no sensible default for an
address only the merchant knows.

**The all-products page is derived from the product pattern**, not configured
separately: the pattern with the placeholder's own segment and everything after
it dropped, so `/products/{slug}` → `/products` and `/shop/p/{slug}` →
`/shop/p`. A merchant who moved their product route almost always moved the
listing with it, and a third setting would sit wrong by default. If a fork ever
turns up where this is untrue, that is the moment to add the setting.

**Stability under trailing slashes is enforced on both sides.** Normalization
strips them at write, and the resolver strips them again at read, so a row
written directly — a seed, a migration, a fixture — resolves the same as one
typed into the form. The unit spec asserts the same storefront typed four ways
produces four identical URLs.

**Two new endpoints, both `campaigns.write`.**
`GET /api/admin/stores/:id/storefront` returns the settings plus
`canBuildLinks` and `missing`; `POST /api/admin/stores/:id/storefront/resolve`
turns a Destination into a URL, or a 400 saying why not. Writing the settings
stays on `PATCH /api/admin/stores/:id` at `settings.write` — the same
permission as every other Store setting, as asked. The read side is deliberately
looser: a `product_manager` holds `campaigns.write` but not `settings.write`,
and ticket 11's form has to resolve a destination without being able to change
where the storefront lives.

**The refusal is a 400 on a resolve, not a validation rule on the settings.**
Refusing off-storefront destinations belongs where a destination is named, not
where the storefront is declared — the storefront URL itself is just an
address. This is what makes ticket 11's "told what is wrong before it is
created" possible on the form.

**A custom destination may carry a query string; the storefront URL may not.**
The storefront URL is a base that gets a path appended and then the platform's
`utm_*` on top, so a query on it produces a broken link. A custom destination
is the final URL, and the platform appends its tags correctly to one that
already has a query.

**A product slug is percent-encoded** into the pattern, so a slug containing a
slash cannot open a second path segment.

Not touched: `STOREFRONT_URL`, the process-wide env var the inline editor reads
(`modules/inline-edit/admin-inline-edit.controller.ts`). It is a different
thing — one address for the whole deployment, not one per Store — and folding
it into this setting is its own change with its own blast radius. Worth doing,
but not while a campaign ticket is open.

`CONTEXT.md` gains **Storefront URL**, **Product Path Pattern** and
**Destination** under Tenancy & stores.
