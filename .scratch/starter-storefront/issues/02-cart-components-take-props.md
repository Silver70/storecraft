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

**Status:** ready-for-agent

- [ ] The cart drawer, cart line item, and coupon field receive everything they render, and every callback they invoke, as props
- [ ] None of the three calls a query or a mutation hook
- [ ] The pages and the layout shell own the hook calls and pass data and handlers down
- [ ] The drawer's open state is controllable from outside it while the drawer still renders its own trigger
- [ ] Replacing any of the three components with a differently-styled one requires no change to a page
- [ ] The catalog and checkout components, which already take everything as props, are left alone — no container wrappers are added around components that already comply
- [ ] The add-to-cart button is deliberately **not** part of this slice; it changes together with the optimistic add
- [ ] Using the app confirms unchanged behaviour: drawer opens and closes, quantity steppers work, removals work, coupons apply and clear, badge count is correct
