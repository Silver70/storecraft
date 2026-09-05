# Storefront

A headless commerce storefront for **Commerce OS**, built with TanStack Start
(Vite + TanStack Router + TanStack Query + Tailwind v4). It consumes the
Commerce OS **GraphQL** API and is designed to double as a **reusable template**:
fork it, edit a config file + theme tokens + env vars, and ship a new brand.

Build plan: [`context/storefrontPlan.md`](../../context/storefrontPlan.md).

## Architecture (security model)

The browser **never** holds a secret and **never** talks to the commerce backend
directly. All commerce calls go through TanStack Start **server functions**,
which hold the `X-API-Key`, the backend URL, and the customer's JWT (server env +
httpOnly cookies). The browser only ever talks to _our_ Start server.

```
Browser ──server-fn RPC──► Start server ──POST /graphql (X-API-Key)──► Commerce backend
   └── Stripe.js (publishable key + per-payment clientSecret only)
```

## Getting started

```sh
cd apps/storefront && cp .env.example .env   # then fill in COMMERCE_API_KEY
cd ../.. && npm install                      # from the monorepo root (npm workspaces)
npx turbo dev --filter=storefront            # http://localhost:5173
```

`.env.example` ships a working `COMMERCE_API_URL` (`http://localhost:4000`, the
backend's default port) and the two documented defaults. It leaves four blanks,
of which `COMMERCE_API_KEY` is the only one the catalog needs — Stripe and the
two analytics values are optional. Create the storefront API key in the admin
(**Settings → API Keys**); the raw key is shown once. Seed a populated catalog
with the backend's `npm run db:seed`.

If port 5173 is taken, Vite says so and moves to the next free one — read the
URL it prints rather than assuming 5173.

### Commands

Run from `apps/storefront/`:

| Command              | What it does                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`        | Vite dev server on 5173 (`npx turbo dev --filter=storefront` from root)                   |
| `npm run build`      | `vite build` then `tsc --noEmit` — types are part of the build                            |
| `npm test`           | Vitest, once (see [Tests](#tests))                                                        |
| `npm run test:watch` | Vitest in watch mode                                                                      |
| `npm run preview`    | Serves the build on 4173 — SSR included                                                   |
| `npm start`          | Production server (srvx) on 3000. Fetches `srvx` with `pnpx`, so it needs pnpm on the box |

## Environment variables

These are exactly the seven variables in
[`.env.example`](.env.example) — nothing else is read from `.env`.

| Var                              | Scope       | Notes                                           |
| -------------------------------- | ----------- | ----------------------------------------------- |
| `COMMERCE_API_URL`               | server-only | Backend base URL, no `/graphql` suffix          |
| `COMMERCE_API_KEY`               | server-only | Storefront `X-API-Key` for this store           |
| `VITE_STRIPE_PUBLISHABLE_KEY`    | browser     | Stripe publishable key (safe by design)         |
| `VITE_ATTRIBUTION_LOOKBACK_DAYS` | browser     | First-touch memory; match the backend (def. 30) |
| `VITE_ANALYTICS_URL`             | browser     | Origin serving `ca.js` — usually the backend    |
| `VITE_ANALYTICS_KEY`             | browser     | Ingest key for `ca.js`. **Use a separate key.** |
| `VITE_ANALYTICS_AUTOCAPTURE`     | browser     | `none` (default) \| `click` \| `form` \| `all`  |

`NODE_ENV` is read too — once, to decide the `Secure` flag on session cookies —
but it belongs in neither file: `vite dev` and the production server each set
it, and writing it into `.env` would override them. `.env.example` names it in a
closing "set by the runtime, not here" section for the same reason.

`VITE_ANALYTICS_KEY` is the one key that reaches the browser, because the
tracking script sends it with every event batch. API keys are store-scoped and
unscoped beyond that, so a key in the browser is a key anyone can create carts
with — create a **second** key in the admin for it rather than reusing
`COMMERCE_API_KEY`. Leave it unset and no script is embedded; attribution
capture and checkout are unaffected either way.

## Project layout

```
public/            favicons, site.webmanifest, your logo (◄ TEMPLATE KNOB)
src/
├── config/        ◄ TEMPLATE KNOBS — store.config.ts, home-sections.ts
│                    (validate-store-config.ts is the boot-time checker; countries.ts feeds the address form)
├── lib/           gql-client (server-only transport), session (cookies), money, utils (cn)
├── types/api.ts   hand-written GraphQL response shapes
├── components/
│   ├── ui/        shadcn primitives
│   └── layout/    Header, Footer, Brand (logo/wordmark), SectionHeading
├── features/      catalog / cart / checkout / attribution
│   └── <feature>/ graphql.ts · server.ts (server fns) · queries.ts (query options)
│                  pages/ (fetch) · components/ (props only)
├── routes/        thin TanStack Router files — a loader and a component, nothing else
├── styles/app.css Tailwind v4 + theme tokens (◄ TEMPLATE KNOB)
└── router.tsx     QueryClient + router wiring
```

`routeTree.gen.ts` is generated by TanStack Router — never hand-edit it.

Only `catalog`, `cart` and `checkout` have `pages/` and `components/`;
`attribution` is all wiring and has neither. There is no `account` feature —
`lib/session.ts` carries customer-token helpers for one, but nothing is built on
them yet.

## Layering: a page may fetch; a component may not

This is the rule the storefront exists to demonstrate, and the one to keep when
you fork it. It is what makes a component safe to restyle or replace: if it
takes everything it renders as props, swapping it in a differently-styled one
requires no change to any page.

- **Pages** (`features/*/pages/`) call the hooks — `useCart`, `useAddToCart`,
  `useCartMutations`, `useSuspenseQuery` — and own the data.
- **Components** (`features/*/components/`, `components/`) receive everything
  they render and every callback they invoke as props. They call no query and no
  mutation hook. Local UI state (a typed coupon code, a validation message) is
  still theirs.
- **Routes** (`routes/`) prefetch in a loader and render a page. No markup.

Four components are the worked examples, and reading them is the fastest way to
see the shape:

| Component                                                                          | Takes                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`cart-drawer.tsx`](src/features/cart/components/cart-drawer.tsx)                  | the cart, `open`/`onOpenChange`, and every handler              |
| [`cart-line-item.tsx`](src/features/cart/components/cart-line-item.tsx)            | one line, its busy flag, quantity + remove callbacks            |
| [`coupon-field.tsx`](src/features/cart/components/coupon-field.tsx)                | `onApply` / `onRemove`; keeps only the typed code and its error |
| [`add-to-cart-button.tsx`](src/features/catalog/components/add-to-cart-button.tsx) | the variant and an `onAdd` — it calls no hook at all            |

One deliberate exception: [`components/layout/header.tsx`](src/components/layout/header.tsx)
calls `useCart` and `useCartMutations`. It is the layout shell, and with no page
above the drawer it stands in for one. The drawer's open state lives higher
still, in [`cart-ui.tsx`](src/features/cart/cart-ui.tsx), because a successful
add on the product page has to be able to open a drawer the header renders.

## Tests

```sh
npm test          # once
npm run test:watch
```

Vitest, in [`vitest.config.ts`](vitest.config.ts) — deliberately **not** an
extension of `vite.config.ts`. `environment: "node"`, `src/**/*.spec.ts`, no DOM
and no component rendering: none of TanStack Start, React or Tailwind is needed
to exercise a pure function, and loading them would drag a server runtime into a
run that opens no browser. 64 specs in two files:

- [`features/cart/utils.spec.ts`](src/features/cart/utils.spec.ts) (36) — the
  three pure cart-patch functions behind the optimistic UI:
  `optimisticQuantity`, `optimisticRemove`, `optimisticAdd`. Every figure is
  asserted in integer cents, and each function is asserted not to mutate the
  cached cart it was handed, since that cart is what a rollback restores.
- [`config/validate-store-config.spec.ts`](src/config/validate-store-config.spec.ts)
  (28) — the boot-time config check: a bad currency, locale, logo, typeface or
  link is named as a field rather than surfacing later as a blank price.

Components are verified by running the app, not by rendering them in a test.
That is a decision, not a gap: the components take props and hold no logic worth
pinning, and the arithmetic that _is_ worth pinning was moved out into the pure
functions above precisely so it could be tested without a DOM.

## Attribution

The storefront is the reference implementation of the commerce API's
attribution contract, so a merchant who forks it gets campaign reporting
without writing anything.

On landing it reads the UTM parameters and the referrer, and keeps them:

- **First touch** is written once and held for the Lookback Window, so a
  visitor who returns a week later — as someone considering a large purchase
  does — is still credited to the campaign that found them.
- **Last touch** advances on each new attributed arrival, so a return through a
  different ad is recorded without disturbing the first.

The cart is created lazily by the first **Add to cart**, so that call is the
moment attribution has to travel: `useAddToCart` reads the stored touches at
click time and sends them with the add. The optimistic line that appears
instantly is a local estimate and carries nothing — attribution rides the server
call underneath it, and an add that fails and rolls back sends nothing at all. A
later arrival while a cart is already open tells the open cart separately.
Checkout then freezes the touches onto the order.

Landing with no UTM parameters is not an error: the visitor checks out normally
and the order lands in the Unattributed bucket. Capture is local, synchronous,
and runs from an effect after paint — it makes no request of its own and is on
no rendering path, so it cannot slow browsing or adding to cart.

Nothing personal is collected. The visitor and session ids are random UUIDs
(shared with `ca.js` so events and orders line up), the UTM values come from the
merchant's own ad links, the referrer is reduced to origin + path, and the
landing path drops its query string.

| File                             | Role                                           |
| -------------------------------- | ---------------------------------------------- |
| `features/attribution/touch.ts`  | The touch rules, as pure functions             |
| `features/attribution/client.ts` | Browser capture + anonymous ids (localStorage) |
| `features/attribution/hooks.ts`  | Runs capture on landing and on navigation      |
| `features/attribution/server.ts` | Tells an open cart about a later arrival       |
| `features/attribution/config.ts` | ◄ TEMPLATE KNOB — lookback + tracking script   |

## Forking checklist (rebrand a new store)

Everything below is config or an asset. No component needs editing to rebrand.

1. **Env** (`.env`): `COMMERCE_API_KEY` at minimum, plus `COMMERCE_API_URL` if
   the backend is not on `localhost:4000`, `VITE_STRIPE_PUBLISHABLE_KEY` to take
   payments, and `VITE_ANALYTICS_URL` + `VITE_ANALYTICS_KEY` for campaign
   reporting.
2. **Store config** — [`src/config/store.config.ts`](src/config/store.config.ts):
   `name`, `description`, `currency`, `locale`, `nav`, `social`.
3. **Logo** — drop a file in `public/` and set `logo: { src, height }` in the
   same config. Leave it unset and `name` renders as a wordmark; either way the
   header and footer match. Currently commented out, so uncomment it.
4. **Typeface** — `typeface: { family, url }`, also in the store config. `url`
   is the stylesheet that loads the font (a Google Fonts link, or your own CSS
   in `public/`); omit it for fonts already on the device. No CSS to edit.
5. **Homepage sections** — [`src/config/home-sections.ts`](src/config/home-sections.ts):
   heading + category slug + limit, per section. The slugs must exist in **your**
   catalog. A section whose slug resolves to nothing renders nothing, silently —
   so an untouched fork against a fresh store shows an empty homepage, and the
   shipped `new` / `apparel` are placeholders, not defaults that work.
6. **Theme tokens** — [`src/styles/app.css`](src/styles/app.css): `--primary`
   (brand color) and `--radius` (roundness). Colors and roundness are defined
   here and nowhere else; the logo and typeface are the two brand knobs that
   live in config instead.
7. **Favicons** — replace the icons in `public/`. `__root.tsx` links
   `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png` and
   `apple-touch-icon.png`; `site.webmanifest` points at the two
   `android-chrome-*.png`. In that manifest, `name` and `short_name` ship
   **blank** — fill them in, and set `theme_color` to your brand color.
8. **Deploy** — `npm run build`, then `npm start` (or serve `dist/` with your own
   Node host).

Steps 2–4 are validated when the app boots, because they are the store config:
a bad currency, locale, logo path, typeface or link fails the first request with
a message naming the field and listing every problem at once, rather than
showing up later as a blank price. The browser just gets a 500 — the message is
in the server console, so read the terminal. Steps 5–7 are not: a section slug
matching no category, a broken theme token and a missing favicon each fail
quietly, so check those by looking at the page.
