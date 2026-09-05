# 04: A fork that actually starts

**What to build:** A developer forking the Starter Storefront runs the first
command in the README and it works.

Today it does not. The README opens with `cp .env.example .env` and no such file
exists. The store config exposes an `accounts` toggle that nothing reads, so a
reader reasonably infers a feature that is not there and goes looking for it. A
bad `currency` or `locale` fails somewhere inside a formatting call at render
time rather than at startup, surfacing as a blank price rather than an error
naming the field.

The template promises a five-minute rebrand and currently delivers a scavenger
hunt. This slice makes the first five minutes true.

Config that lies is worse than config that is missing, which is why the dead
toggle is removed rather than implemented. It comes back with the feature, if
the feature comes.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] An `.env.example` exists and copying it is a working first step
- [x] Every environment variable the storefront reads appears in it, each with a one-line comment, and no real values
- [x] The store config is validated when the app starts, and an invalid value fails with a message naming the offending field
- [x] Currency and locale are validated by attempting the formatting construction they will actually be used for, so a syntactically plausible locale that is rejected at runtime is caught at startup instead of showing a blank price
- [x] The `accounts` feature toggle is removed, along with the type that declares it
- [x] The security boundary is unchanged: server-only variables stay server-only, and the only key that reaches the browser is still the tracking key the README already explains

## Comments

Implemented 2026-09-05.

`.env.example` lists all seven variables the storefront reads, in the same
sections and order as the working `.env`, each with a one-line comment and no
real value — a localhost backend URL and the two documented defaults (`30`,
`none`) are the only values present. `NODE_ENV` is named too, in a closing
"set by the runtime, not here" section: it is read (the `Secure` flag on
session cookies) but writing it into `.env` would override what `vite dev` and
the production server already set, so listing it as a variable to fill in would
have been the same kind of lie the dead toggle was. Verified by loading the
file through Vite's own `loadEnv`: every key parses, and the placeholders come
back empty.

The store config is validated at module load. `store.config.ts` now wraps its
literal in `validateStoreConfig`, so the first import — `__root.tsx` → `header`
→ config, on the first request — either returns a valid config or throws.
`validate-store-config.ts` holds the checking so the knob file stays a knob
file; it takes the config type as a type-only import, which erases, so there is
no runtime cycle. Errors accumulate and throw together as one `StoreConfigError`
listing every problem, because a merchant filling in a fresh fork usually has
more than one and fixing them one boot at a time is the scavenger hunt this was
meant to end.

TypeScript already rejects a wrong _type_; what it cannot judge is whether a
string is a real one, so currency and locale are checked by performing the
`Intl.NumberFormat` construction `lib/money.ts` performs — including the
`.format()` call. Each is probed alone first (the currency against a known-good
locale) so two bad values produce two messages instead of one blaming whichever
threw first, then the pair is probed together in the exact shape `formatMoney`
uses. `nav` and `social` targets are checked too: a nav entry must be a path,
and a social entry must be a path or an absolute URL, because `"x.com/acme"`
rendered as a bare `href` quietly resolves against the storefront's own origin.

`features.accounts` and the `features` type that declared it are gone; nothing
referenced either. The README's fork checklist named `features` as a knob, so
that line now names the fields that exist — the rest of the README is 06's.

Verified on two levels. Sixteen new specs in
`src/config/validate-store-config.spec.ts` (52 in the app): the shipped config
passes, `"en_US"` and `"USDD"` are each rejected with the field named, a bad
locale and a bad currency produce two separate messages, other real pairs
(`EUR`/`de-DE`, `JPY`/`ja-JP`) pass, blank identity fields are refused, link
problems are named by index, and the thrown message lists every problem. And by
running the app: with `locale: "en_US"` the dev server returns 500 on the first
request with `locale "en_US" is not a locale Intl accepts (Incorrect locale
information provided). Use a BCP 47 tag such as "en-US".`; with
`currency: "USDD"` the same, naming currency; restored, the page renders 200
with the title and description in place. `npm run build` and `tsc --noEmit`
pass.

The security boundary is untouched — no server-only variable moved, no new
`VITE_` variable exists, and the built `dist/client` bundle contains neither the
`COMMERCE_API_KEY` value nor its name.

One gap: `.env.example` is verified to parse and to boot the config, not to
reach a populated catalog. A straight `cp` leaves `COMMERCE_API_KEY` empty, so
the first product fetch fails until the merchant fills it in — which is what the
README's comment on that line already says.
