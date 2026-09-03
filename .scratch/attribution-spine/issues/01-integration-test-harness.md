# 01: Integration-test harness on local Postgres

**What to build:** A committed end-to-end test that exercises the existing storefront purchase path — create a Cart, add an item, check out — against a local Postgres database, so that every later ticket in this feature has a place to prove its behaviour end to end. Nothing user-facing changes; this establishes the seam the rest of the work is verified at.

The harness boots the real application, seeds an Organization, Store, API key, product and variant, runs the flow through the public storefront API, and removes everything it created afterward. It proves itself against behaviour that already works before anything new depends on it.

The backend environment currently points at the hosted database. Reconcile it so tests run against local Postgres — a teardown step against a shared database risks destroying real rows.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A test creates a Cart, adds a variant, and checks out through the storefront API, asserting an Order is created with the expected total
- [ ] The test runs against local Postgres, not the hosted database
- [ ] Seeded data is scoped to the test and removed afterward, leaving no residue between runs
- [ ] The suite can be run repeatedly without manual cleanup and without failing on leftover state
- [ ] Running the existing unit specs is unaffected
