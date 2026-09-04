# 02: Attribution captured on Cart, frozen on Order

**What to build:** A storefront can declare where a Visitor came from when it creates a Cart, and that evidence ends up permanently recorded on the resulting Order.

When a Cart is created, the storefront may pass First Touch and Last Touch UTM values, the referrer, the landing path, the visitor id and the session id. First Touch is written once and never overwritten. Last Touch is updated whenever a new non-direct Touch arrives before the Cart converts. At checkout both groups are copied onto the Order and frozen — a Customer who returns later through a different ad does not rewrite an Order already placed.

Attribution is optional everywhere. A storefront that passes nothing still checks out normally, and the Order records that its attribution source is `none`. Attribution resolution must never be able to fail a checkout.

Per ADR-0001 the raw UTM tuple is the immutable fact stored here; no Campaign reference is recorded on the Order.

**Blocked by:** 01

**Status:** resolved

- [x] Creating a Cart with attribution stores First Touch and Last Touch on the Cart
- [x] A second attributed arrival on the same Cart updates Last Touch and leaves First Touch untouched
- [x] Checking out copies both Touch groups onto the Order
- [x] Updating attribution on a Cart after its Order exists does not alter the Order
- [x] Creating a Cart without attribution succeeds, and checkout produces an Order with attribution source `none`
- [x] The attribution fields are optional on the storefront API and their absence never produces an error
- [x] Attribution never crosses an Organization or Store boundary
- [x] A failure while resolving attribution is logged and still yields a successful checkout

## Comments

Implemented 2026-09-04.

**Schema.** One column group, defined once in
`src/shared/database/schema/attribution.schema.ts` and spread into both `carts`
and `orders` so the two can never drift: an `attribution_source` enum
(`none` / `declared` / `correlated`), `visitor_id`, `session_id`, and a
first-touch and last-touch group each carrying utm source/medium/campaign/content,
referrer, landing path, and the touch timestamp. Migration
`0008_attribution_on_cart_and_order.sql`. Per ADR-0001 there is deliberately no
`campaign_id` — the raw tuple is the fact, the Campaign is an interpretation
resolved later by matching rules.

**Touch rules, as pure functions.** `src/shared/attribution/attribution.util.ts`
folds a declaration into what a cart already carries and returns only the
columns that change: first touch is write-once, last touch advances, and a
direct touch (no UTM value, no referrer) records nothing. Two details worth
naming. Last touch only ever moves forward in time, so a storefront re-sending
the first touch it has stored cannot drag last touch back onto the older
arrival. And every value is trimmed, blank-dropped and truncated to the column
width, so an over-long referrer degrades instead of failing the write it rides
along with — the same reason a future or unparseable `occurredAt` clamps to now
rather than erroring.

**API.** `createCart(attribution: CartAttributionInput)` — every field optional,
including the object itself. A new `recordCartAttribution(cartId, attribution)`
mutation records a later arrival, and `CartType.attribution` exposes what the
cart now holds so a storefront can see the effect of what it sent. Checkout
copies the group onto the order through `CartAttributionService.resolveForOrder`,
which is also where ticket 07's event-log correlation will attach.

**Late touches are allowed on a converted cart, deliberately.**
`recordAttribution` does not gate on the cart still being `active`, unlike every
other cart mutation. Attribution is evidence about a visitor, not commerce
state — it moves no money and changes no total — and the order already carries
its own frozen copy. So a visitor returning through a different ad updates the
cart and leaves the order they already placed exactly as purchased, which is the
freeze property stated positively rather than by refusing the write.

**Checkout can never fail on attribution.** `CheckoutService` wraps the resolve
in a try/catch that logs and falls back to an unattributed snapshot. The e2e
suite proves this by making `resolveForOrder` reject and asserting the sale
still completes with the order in the Unattributed bucket — the guard lives in
the checkout path, not inside the service, so a fault injected at the service
actually exercises it.

**Tests.** `test/storefront-attribution.e2e-spec.ts` (8 tests, seam 1) drives
every acceptance criterion through the public storefront GraphQL API against
local Postgres and asserts on the persisted rows: both touch groups stored on
the cart, a second arrival advancing last touch while first survives, the copy
onto the order, a later touch not altering a placed order, an unattributed
checkout, partial and direct declarations, another tenant's key unable to read
or rewrite a cart, and the fault-injection case above.
`src/shared/attribution/attribution.util.spec.ts` (11 tests) covers the touch
rules as a pure unit. No repository or mocked-service specs, per the spec's
testing decisions.

Verified: `npm run test:e2e` 12 passed (3 suites, no residue between runs);
`npm test` 92 passed; `tsc --noEmit` and eslint clean on everything touched (the
one eslint error in `order.service.spec.ts` is pre-existing and unrelated).
