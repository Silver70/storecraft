# 03: Optimistic add to cart

**What to build:** A Visitor clicks "Add to cart" and the cart responds
immediately — the line appears, the header badge moves — and the drawer opens
once the server confirms. The one interaction the entire funnel narrows to stops
being the slowest thing on the site.

Quantity edits and removals already work this way. Adding does not, and three
things make it harder than the two that exist:

**There may be no cart yet.** The cart is created lazily on the first add, so
the patch synthesizes a whole cart rather than amending one. A shopper's first
add must feel exactly like their second.

**A repeat variant merges.** Adding a variant already in the cart raises that
line's quantity. Appending a second line would double the badge count and show
a cart the shopper does not have — this is the failure that gets reported as
"it added it twice", and it is invisible in any manual test that only ever adds
one thing.

**The line id does not exist yet.** An optimistic line carries a temporary id
the server has never issued, so quantity and remove controls are disabled on it
until the real cart lands.

The add-to-cart button becomes props-only in this slice rather than in 02,
because the optimistic line needs the product's display details at click time
and the only way the button can have them without fetching is for the product
page to pass them down. Separating first would leave props nothing uses.

The estimate is transient. It lives for one round-trip, is never persisted, is
never read by checkout — which derives the cart id from the cookie server-side —
and is replaced wholesale by the server's authoritative cart. This is the same
qualification the existing patch functions already document; it is being
extended, not reopened.

Attribution is unchanged: it is still read at click time and still travels with
the call that creates the cart.

**Blocked by:** 01 (Vitest and cart patch coverage), 02 (Cart components take props).

**Status:** ready-for-agent

- [ ] Clicking Add patches the cached cart immediately: the line is visible and the header badge has moved before any server response
- [ ] Adding when no cart exists yet synthesizes a cart containing the line, with discount, tax, and shipping at zero
- [ ] Adding a variant already in the cart merges into that line rather than appending a second
- [ ] The badge count after a merge is the sum, not a double count
- [ ] The optimistic line renders the product name, variant, image, and unit price the shopper was just looking at, passed from the product page rather than fetched
- [ ] The add-to-cart button takes everything it renders and everything it adds as props, and calls no hook
- [ ] An optimistic line is distinguishable from a server-issued one, and its quantity and remove controls are disabled until the real cart arrives
- [ ] The server's cart replaces the estimate wholesale on success, leaving no optimistic remnant
- [ ] A failed add restores the cart exactly as it was and tells the shopper it failed
- [ ] The drawer opens on a **successful** add, never on the optimistic patch, so a failure does not open a drawer onto a rolled-back cart
- [ ] The existing recovery from a swept or converted cart still works — the visitor is never stuck on a dead cart
- [ ] Two quick clicks add two units, neither swallowed nor doubled
- [ ] In-flight cart reads are cancelled before patching, and the last server response wins
- [ ] Attribution still travels with the first add, unchanged
- [ ] The patch is a pure function covered by unit specs: no cart yet, repeat variant merging, badge count after a merge, totals moving as a transient estimate, optimistic lines distinguishable, and no remnant after the server cart lands
- [ ] The browser still holds no secret and every commerce call still goes through a server function
