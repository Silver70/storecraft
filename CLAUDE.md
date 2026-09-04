# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multi-tenant headless commerce engine built as a Turborepo monorepo. The system serves as a single source of truth for product catalog, inventory, orders, and payments, consumed by storefronts via a GraphQL API and managed via a REST-based admin dashboard. Full product requirements and data models are in [context/headless-commerce-mvp-prd.md](context/headless-commerce-mvp-prd.md). Admin UI screens are spec'd in [context/admin-dashboard-ui-screens.md](context/admin-dashboard-ui-screens.md).

## Apps

- **`apps/frontend`** — The storefront (TanStack Start + Vite). Uses TanStack Router (file-based routing, auto-generated `routeTree.gen.ts`), TanStack Query for data fetching (with SSR query integration), and Tailwind CSS v4. Runs on port 3000 via `vite dev`.
- **`apps/backend`** — The commerce engine API (not yet scaffolded). Will expose GraphQL for storefronts and REST for admin + webhooks.

## Packages

- **`packages/ui`** — Shared React component stubs (`button.tsx`, `card.tsx`, `code.tsx`).
- **`packages/eslint-config`** — Shared ESLint configs (Next.js + Prettier).
- **`packages/typescript-config`** — Shared `tsconfig.json` bases (`base`, `nextjs`, `react-library`).

## Commands

Run from the monorepo root:

```sh
npm run dev          # Start all apps in watch mode (turbo)
npm run build        # Build all apps
npm run lint         # Lint all packages
npm run check-types  # Type-check all packages
npm run format       # Prettier format all TS/MD files
```

Target a specific app with turbo filter:

```sh
npx turbo dev --filter=frontend
npx turbo build --filter=frontend
```

Backend tests (from `apps/backend/`):

```sh
npm test         # unit specs (src/**/*.spec.ts), no database
npm run test:e2e # integration suite (test/**/*.e2e-spec.ts), local Postgres
```

The integration suite boots the real application against a local Postgres
database, reached through the public storefront GraphQL API. It reads
`.env.test` — never `.env`, which points at the hosted database — and aborts if
`DATABASE_URL` resolves to a non-local host, because it seeds and deletes rows.
Global setup creates `commerce_os_test` and migrates it; each test seeds its own
Organization and deletes it afterward, which every tenant-scoped table cascades
from. Stripe is replaced by an in-memory `PaymentProvider` fake; everything else
is production wiring. Add new end-to-end coverage here rather than mocking
repositories.

Frontend only (from `apps/frontend/`):

```sh
npm run dev          # vite dev (port 3000)
npm run build        # vite build && tsc --noEmit
npm run preview      # vite preview
```

## Architecture

### Multi-Tenancy (Critical)

Every tenant-scoped table has `organization_id UUID NOT NULL` as its second column. **This is enforced everywhere without exception.** The `TenantScopedRepository` base class auto-injects `organization_id` on all queries. PostgreSQL Row-Level Security acts as a second line of defense (see PRD §3.4 and Appendix C).

Auth resolves `organization_id` from three sources depending on caller:
- **Admin dashboard** → self-issued admin JWT (httpOnly cookie) → `organization_id` from the `org_id` claim
- **Storefront** → `X-API-Key` header → API key lookup → `organization_id`
- **Stripe webhooks** → payment intent ID → internal payment record → `organization_id`

### API Split

- **GraphQL** (`POST /graphql`): storefront-only. No admin mutations in GraphQL.
- **REST** (`/api/admin/*`): admin dashboard + webhooks. Protected by the admin JWT + RBAC.

### Auth Split

- **Admin users** → self-hosted email/password + JWT, issued by the commerce engine (`AdminAuthService`). Identities live in `admin_users`; org membership and role live in `organization_members` (three roles: `super_admin`, `product_manager`, `support_agent`). Access token is HS256/1h, refresh token 7d with rotation + revocation via `admin_sessions`. Self-serve signup at `POST /api/auth/admin/register` creates user + org + `super_admin` membership.
- **Storefront customers** → lightweight JWT issued by the commerce engine. Separate auth stack (`CustomerAuthService`).

Both stacks are first-party — there is no third-party identity provider. Frontend session lives in httpOnly `admin-access` / `admin-refresh` cookies set by `apps/frontend/src/server/auth.ts`.

### Money

All monetary values are stored as integers (cents / smallest currency unit). **Never floats.** Never format money server-side except in the GraphQL `Money.formatted` field.

### Frontend Stack

The `apps/frontend` app uses TanStack Start (built on Vite + TanStack Router):

- **Routing**: file-based via TanStack Router. Routes live in `src/routes/`. The route tree is auto-generated into `src/routeTree.gen.ts` — do not hand-edit that file.
- **Data fetching**: TanStack Query (`@tanstack/react-query`). The `QueryClient` is created in `src/router.tsx` and injected into router context. SSR hydration is handled by `@tanstack/react-router-ssr-query`.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin (no `tailwind.config.*` file needed).
- **Root layout**: `src/routes/__root.tsx` wraps the app with `QueryClientProvider` and devtools.
- **Entry point**: Vite handles SSR; no hand-written `server.ts`.

### Planned Backend Module Structure

```
src/modules/
  auth/          Admin auth (JWT + sessions), customer JWT, API key service, RBAC middleware
  product/       Products, variants, options, categories, media
  inventory/     Stock items, reservations, threshold alerts
  pricing/       Discounts, coupons, pricing engine
  cart/          Cart CRUD, checkout service
  order/         Order state machine, timeline, refunds
  customer/      Storefront customer accounts, addresses
  payment/       Stripe adapter behind PaymentProvider interface, webhooks
  shipping/      Zones, methods, shipments
  audit/         Audit log service + viewer

src/shared/
  tenant/        TenantContext, TenantScopedRepository, RLS setup
  events/        In-process event bus + typed event definitions
  graphql/       Merged schema, scalars (Money, DateTime), directives
  database/      Connection, migrations, seeds
  utils/         money.ts (integer arithmetic), slug.ts, pagination.ts (cursor codec)
```

### Key Business Logic Rules

- **Inventory mutations are atomic**: all stock changes use `SELECT FOR UPDATE` in a single transaction. Never allow `quantity - reserved` to go negative unless `allow_backorder` is true.
- **Order line items are immutable snapshots**: product name, SKU, price, image URL are captured at order creation. Repricing or deleting a product does not change existing orders.
- **Order attribution is frozen at checkout**: the first-touch and last-touch UTM tuples, referrer, landing path, and visitor/session ids are copied from the cart onto the order and never written again (ADR-0001). On the cart, first touch is write-once and last touch advances. Attribution is optional on the storefront API and resolving it can never fail a checkout — a failure logs and records the order as `none`.
- **Order state machine**: `pending → paid → processing → shipped → delivered`. Any post-`pending` state can transition to `refunded`. Invalid transitions throw errors.
- **Stock reservation TTL**: 15 minutes (configurable). A background job expires stale reservations.
- **Checkout is idempotent**: use `Idempotency-Key` header on checkout and payment mutations.
- **`findById` always includes `org_id` check**: never trust a UUID belongs to the current tenant without checking.

## Environment Variables

See Appendix B of the PRD for the full list. Key ones:

```
DATABASE_URL              PostgreSQL connection string
ADMIN_JWT_SECRET          64+ char secret for self-issued admin dashboard JWTs
CUSTOMER_JWT_SECRET       64-char secret for storefront customer JWTs
STRIPE_SECRET_KEY         Stripe secret
STRIPE_WEBHOOK_SECRET     Stripe webhook signing secret
```

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim, recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
