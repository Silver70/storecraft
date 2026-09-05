# 02: Cart components take props; pages own the data

**What to build:** A developer who forks the Starter Storefront can restyle or
replace the cart drawer, the cart line item, or the coupon field without knowing
anything about React Query.

Today each of those three reaches for a data hook itself, which means the
reference implementation teaches a forking merchant that a component is where
fetching lives. It is not. The rule this slice establishes, and which the
storefront is meant to demonstrate: **a page may fetch; a component may not.**

The drawer's open state is lifted out of the drawer as part of this. It keeps
rendering its own trigger, but something outside it — a successful add, in the
next slice — has to be able to open it.

Nothing the shopper sees changes. This slice is verified by using the app: the
drawer, the cart page, quantity edits, removals, and coupons all behave exactly
as they did.

This is also the groundwork ADR-0003 will need. Inline Editing has the storefront
mark editable regions for an admin that owns all editing chrome, and a component
that fetches its own data has no stable boundary to mark. Nothing about Inline
Editing is built here.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The cart drawer, cart line item, and coupon field receive everything they render, and every callback they invoke, as props
- [x] None of the three calls a query or a mutation hook
- [x] The pages and the layout shell own the hook calls and pass data and handlers down
- [x] The drawer's open state is controllable from outside it while the drawer still renders its own trigger
- [x] Replacing any of the three components with a differently-styled one requires no change to a page
- [x] The catalog and checkout components, which already take everything as props, are left alone — no container wrappers are added around components that already comply
- [x] The add-to-cart button is deliberately **not** part of this slice; it changes together with the optimistic add
- [ ] Using the app confirms unchanged behaviour: drawer opens and closes, quantity steppers work, removals work, coupons apply and clear, badge count is correct

## Comments

Implemented 2026-09-05.

`CartDrawer`, `CartLineItem` and `CouponField` take everything as props and
import no hook. The two hook owners are `CartPage` and the `Header`: the header
is the layout shell, and with no page above the drawer it is where `useCart` and
`useCartMutations` belong. Drilling nine props from `__root.tsx` through the
header to reach the same place would have been the ceremony the spec warns
against.

The drawer takes `open` / `onOpenChange` and passes them straight to the Radix
`Sheet`, while still rendering its own `SheetTrigger`. The state currently lives
in the header; 03 moves it wherever a successful add can reach it.

`CouponField` keeps the typed code and the error message — those are UI state,
not server state — and takes `onApply: (code) => Promise<unknown>`. Resolving
clears the input, rejecting shows the message under the field, which is exactly
what the old `mutate(..., { onSuccess, onError })` did, so both callers pass
`applyCoupon.mutateAsync`.

One difference had to be designed around rather than translated. Each line item
used to call `useCartMutations` itself, so `busy` was per-line: editing one line
left the others live. A single `isUpdating` boolean on the page would have
frozen every line at once — small, but visible, and this slice changes nothing
the shopper sees. `useCartMutations` now derives `pendingItemId` from the
in-flight mutation's variables, and a line disables only when it matches.

The add-to-cart button still calls `useCartMutations` — deliberate, per 03.

Verified against the running app rather than by test, on two levels.

Statically: with a two-line, three-unit cart seeded through the real backend,
the SSR markup of `/` and `/cart` is byte-identical before and after the
refactor apart from React Query's dehydration timestamps.

Dynamically: a throwaway WebDriver BiDi script (headless Firefox, scratch
directory, nothing committed — this repo has no DOM test environment and per
Testing Decisions is not getting one) drove the real storefront against the
real backend. Add from the PDP moves the badge; the drawer opens from its own
trigger with its line and coupon field; the steppers increment and decrement in
both the drawer and the cart page; a rejected coupon shows
`Coupon code "NOPE-NOT-REAL" is not valid` under the field, keeps the typed
code, and leaves the cart untouched; the drawer closes when its "View cart"
link navigates; a removal empties the cart, the badge, and shows both empty
states. Eleven checks, all passing.

The one gap: applying a **valid** coupon and clearing it again is unverified,
because this dev store has no coupon and seeding one means writing to the
hosted database. That leaves `CouponField`'s applied branch — the "Coupon X
applied" row and its X button — exercised only through its props, never against
a real applied coupon. Worth a manual pass, or a seeded coupon and a re-run.
