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

**Status:** ready-for-agent

- [ ] `npm test` runs in the storefront app and is wired into the monorepo task pipeline the way the other apps' scripts are
- [ ] The runner is configured for unit tests only — no DOM environment, no component rendering, no browser
- [ ] The existing quantity patch is covered: changing a line's quantity updates that line's total, the subtotal, and the cart total
- [ ] Quantity zero removes the line rather than leaving a zero-quantity row
- [ ] The existing remove patch is covered: the line disappears and the totals move accordingly
- [ ] Removing the last line leaves an empty cart rather than a malformed one
- [ ] Money assertions are in the smallest currency unit throughout, never floats
- [ ] The specs assert returned values only, and never that some function was called
