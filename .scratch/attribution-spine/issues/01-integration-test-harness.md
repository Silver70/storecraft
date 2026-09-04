# 01: Integration-test harness on local Postgres

**What to build:** A committed end-to-end test that exercises the existing storefront purchase path — create a Cart, add an item, check out — against a local Postgres database, so that every later ticket in this feature has a place to prove its behaviour end to end. Nothing user-facing changes; this establishes the seam the rest of the work is verified at.

The harness boots the real application, seeds an Organization, Store, API key, product and variant, runs the flow through the public storefront API, and removes everything it created afterward. It proves itself against behaviour that already works before anything new depends on it.

The backend environment currently points at the hosted database. Reconcile it so tests run against local Postgres — a teardown step against a shared database risks destroying real rows.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] A test creates a Cart, adds a variant, and checks out through the storefront API, asserting an Order is created with the expected total
- [x] The test runs against local Postgres, not the hosted database
- [x] Seeded data is scoped to the test and removed afterward, leaving no residue between runs
- [x] The suite can be run repeatedly without manual cleanup and without failing on leftover state
- [x] Running the existing unit specs is unaffected

## Comments

Implemented 2026-09-03.

**Environment reconciliation.** `DatabaseModule` hard-coded Neon's HTTP driver,
which cannot speak to an ordinary Postgres server. Driver selection now lives in
`src/shared/database/drizzle.factory.ts` and is made from the URL: a
`*.neon.tech` host gets the Neon HTTP driver, anything else gets a node-postgres
pool. node-postgres rather than postgres-js because its `execute()` returns
`.rows` / `.rowCount` — the same shape the dashboard and analytics raw-SQL
queries already read, which postgres-js would have broken. `migrate.ts` picks
its driver the same way. Both paths were verified against their real databases.

**Not pointing the tests at the hosted database.** `.env.test` (committed,
local-only values) is applied with `override: true` by `test/helpers/test-env.ts`,
so neither a shell variable nor `.env` can redirect a run, and the suite aborts
in global setup if `DATABASE_URL` resolves to any non-local host. Both were
verified: a Neon URL exported into the shell does not redirect the run, and one
placed in `.env.test.local` aborts before any database work.

**The harness.** `test/global-setup.ts` creates `commerce_os_test` if missing
(from `template0` — this machine's `template1` carries a stale collation version
after a glibc upgrade) and applies the committed migrations. Each test seeds its
own Organization via `test/helpers/storefront-fixture.ts`; teardown is a single
delete of that Organization, which every tenant-scoped table cascades from.
Slugs and SKUs are unique per fixture, and global setup sweeps Organizations
left by a run that died before its teardown, so repeat runs never collide or
need manual cleanup.

**What the test proves.** `test/storefront-checkout.e2e-spec.ts` drives
createCart → addToCart → checkout over HTTP through the storefront GraphQL API,
authenticated by a real hashed API key, and asserts the persisted Order's
totals, its line-item snapshot, the spent cart, and the amount that reached the
payment leg. Stripe is the one substitution — an in-memory `PaymentProvider`
fake, swapped at the interface that exists for that purpose.

Verified: `npm run test:e2e` 4 passed (twice, with zero residue in the test
database between runs); `npm test` 81 passed, unchanged; `tsc --noEmit`,
`nest build`, and eslint clean.
