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
cp .env.example .env        # fill in COMMERCE_API_URL, COMMERCE_API_KEY, VITE_STRIPE_PUBLISHABLE_KEY
npm install                 # from the monorepo root (npm workspaces)
npx turbo dev --filter=storefront   # http://localhost:5173
```

Create the storefront API key in the admin (**Settings → API Keys**); the raw
key is shown once. Seed a populated catalog with the backend `db:seed` script.

## Environment variables

| Var                              | Scope       | Notes                                           |
| -------------------------------- | ----------- | ----------------------------------------------- |
| `COMMERCE_API_URL`               | server-only | Backend base URL, no `/graphql` suffix          |
| `COMMERCE_API_KEY`               | server-only | Storefront `X-API-Key` for this store           |
| `VITE_STRIPE_PUBLISHABLE_KEY`    | browser     | Stripe publishable key (safe by design)         |
| `VITE_ATTRIBUTION_LOOKBACK_DAYS` | browser     | First-touch memory; match the backend (def. 30) |
| `VITE_ANALYTICS_URL`             | browser     | Origin serving `ca.js` — usually the backend    |
| `VITE_ANALYTICS_KEY`             | browser     | Ingest key for `ca.js`. **Use a separate key.** |
| `VITE_ANALYTICS_AUTOCAPTURE`     | browser     | `none` (default) \| `click` \| `form` \| `all`  |

`VITE_ANALYTICS_KEY` is the one key that reaches the browser, because the
tracking script sends it with every event batch. API keys are store-scoped and
unscoped beyond that, so a key in the browser is a key anyone can create carts
with — create a **second** key in the admin for it rather than reusing
`COMMERCE_API_KEY`. Leave it unset and no script is embedded; attribution
capture and checkout are unaffected either way.

## Project layout

```
src/
├── config/        ◄ TEMPLATE KNOBS — store.config.ts, home-sections.ts
├── lib/           gql-client (server-only transport), session (cookies), money, utils (cn)
├── types/api.ts   hand-written GraphQL response shapes
├── components/
│   ├── ui/        shadcn primitives
│   └── layout/    Header, Footer, Brand (logo/wordmark), CartButton, SectionHeading
├── features/      catalog / cart / checkout / account / attribution (per-feature server.ts + queries.ts)
├── routes/        thin TanStack Router files (loaders only)
└── styles/app.css Tailwind v4 + theme tokens (◄ TEMPLATE KNOB)
```

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
- Both travel to the commerce API when the cart is created, and again if a new
  arrival lands while a cart is already open. Checkout freezes them onto the
  order.

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

1. Set env vars (`.env`): `COMMERCE_API_URL`, `COMMERCE_API_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`,
   and — for campaign reporting — `VITE_ANALYTICS_URL` + `VITE_ANALYTICS_KEY`.
2. Edit [`src/config/store.config.ts`](src/config/store.config.ts) — name, description, logo, typeface, currency, locale, nav, social.
3. Edit [`src/config/home-sections.ts`](src/config/home-sections.ts) — homepage sections by category slug.
4. Adjust theme tokens in [`src/styles/app.css`](src/styles/app.css) — `--primary` (brand color), `--radius` (roundness). Colors and roundness live here; the typeface is a config knob.
5. Drop your logo in `public/`, point `logo` at it, and swap the favicons. With no logo set, the store name renders as a wordmark.
6. Deploy.
