# 01: Vitest in the storefront, covering the existing cart patch functions

**What to build:** The Starter Storefront gains a test runner and uses it on the
one thing in the app worth testing — the pure functions that patch a cached cart
so the UI feels instant.

Nothing user-facing changes. This is the prefactor that makes the next slice
easy: the optimistic add is a third patch function, and it should arrive to a
working runner and a worked example of the test shape rather than setting up
tooling mid-slice.

The two patch functions that already exist have no coverage at all, and they
compute money — a transient estimate, replaced by the server's authoritative
cart, but money the shopper reads. They get covered here.

Vitest rather than Jest because the storefront is a Vite app whose config
already exists. The backend keeps Jest; this is not a migration of anything.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] `npm test` runs in the storefront app and is wired into the monorepo task pipeline the way the other apps' scripts are
- [x] The runner is configured for unit tests only — no DOM environment, no component rendering, no browser
- [x] The existing quantity patch is covered: changing a line's quantity updates that line's total, the subtotal, and the cart total
- [x] Quantity zero removes the line rather than leaving a zero-quantity row
- [x] The existing remove patch is covered: the line disappears and the totals move accordingly
- [x] Removing the last line leaves an empty cart rather than a malformed one
- [x] Money assertions are in the smallest currency unit throughout, never floats
- [x] The specs assert returned values only, and never that some function was called

## Comments

Implemented 2026-09-05.

Vitest 5 in `apps/storefront` with its own `vitest.config.ts` rather than the
app's `vite.config.ts`. Extending the app config would have pulled TanStack
Start, React and Tailwind into a run that renders nothing; the test config
carries only the `~` alias, `environment: "node"`, and
`include: ["src/**/*.spec.ts"]` — the same file convention the backend's unit
specs use. `npm test` is `vitest run` in the app, a `test` task in `turbo.json`
alongside `lint` and `check-types`, and `turbo run test` at the root, which now
runs the storefront's 16 specs and the backend's 263.

`src/features/cart/utils.spec.ts` covers both existing patch functions against
one two-line fixture cart and a discounted variant of it. Beyond the stepper and
removal arithmetic, four cases are worth naming: a quantity of zero (or below)
drops the row rather than rendering `0 ×`; the discount is carried across
unchanged, because the client cannot reprice a coupon and the round-trip is what
recomputes it; the total floors at zero when a discount outruns the shrinking
subtotal; and emptying the last line leaves a cart that still has its id,
currency and status, so the drawer's empty state renders and the server response
has something to land on. Both functions are also asserted not to mutate the
cached cart they were handed — patching in place would leave `onError` nothing
to roll back to.

Every figure is asserted in integer cents, with one test pinning
`Number.isInteger` across the patched totals so a division cannot creep into the
estimate unnoticed. Nothing asserts that a function was called.
