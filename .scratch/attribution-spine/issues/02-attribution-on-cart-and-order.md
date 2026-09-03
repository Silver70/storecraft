# 02: Attribution captured on Cart, frozen on Order

**What to build:** A storefront can declare where a Visitor came from when it creates a Cart, and that evidence ends up permanently recorded on the resulting Order.

When a Cart is created, the storefront may pass First Touch and Last Touch UTM values, the referrer, the landing path, the visitor id and the session id. First Touch is written once and never overwritten. Last Touch is updated whenever a new non-direct Touch arrives before the Cart converts. At checkout both groups are copied onto the Order and frozen — a Customer who returns later through a different ad does not rewrite an Order already placed.

Attribution is optional everywhere. A storefront that passes nothing still checks out normally, and the Order records that its attribution source is `none`. Attribution resolution must never be able to fail a checkout.

Per ADR-0001 the raw UTM tuple is the immutable fact stored here; no Campaign reference is recorded on the Order.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Creating a Cart with attribution stores First Touch and Last Touch on the Cart
- [ ] A second attributed arrival on the same Cart updates Last Touch and leaves First Touch untouched
- [ ] Checking out copies both Touch groups onto the Order
- [ ] Updating attribution on a Cart after its Order exists does not alter the Order
- [ ] Creating a Cart without attribution succeeds, and checkout produces an Order with attribution source `none`
- [ ] The attribution fields are optional on the storefront API and their absence never produces an error
- [ ] Attribution never crosses an Organization or Store boundary
- [ ] A failure while resolving attribution is logged and still yields a successful checkout
