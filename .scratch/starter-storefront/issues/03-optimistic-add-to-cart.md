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

**Status:** resolved

- [x] Clicking Add patches the cached cart immediately: the line is visible and the header badge has moved before any server response
- [x] Adding when no cart exists yet synthesizes a cart containing the line, with discount, tax, and shipping at zero
- [x] Adding a variant already in the cart merges into that line rather than appending a second
- [x] The badge count after a merge is the sum, not a double count
- [x] The optimistic line renders the product name, variant, image, and unit price the shopper was just looking at, passed from the product page rather than fetched
- [x] The add-to-cart button takes everything it renders and everything it adds as props, and calls no hook
- [x] An optimistic line is distinguishable from a server-issued one, and its quantity and remove controls are disabled until the real cart arrives
- [x] The server's cart replaces the estimate wholesale on success, leaving no optimistic remnant
- [x] A failed add restores the cart exactly as it was and tells the shopper it failed
- [x] The drawer opens on a **successful** add, never on the optimistic patch, so a failure does not open a drawer onto a rolled-back cart
- [x] The existing recovery from a swept or converted cart still works — the visitor is never stuck on a dead cart
- [x] Two quick clicks add two units, neither swallowed nor doubled
- [x] In-flight cart reads are cancelled before patching, and the last server response wins
- [x] Attribution still travels with the first add, unchanged
- [x] The patch is a pure function covered by unit specs: no cart yet, repeat variant merging, badge count after a merge, totals moving as a transient estimate, optimistic lines distinguishable, and no remnant after the server cart lands
- [x] The browser still holds no secret and every commerce call still goes through a server function

## Comments

Implemented 2026-09-05.

`optimisticAdd(cart, line)` joins the two patch functions in
`src/features/cart/utils.ts` and shares their repricing. Three decisions inside
it are worth naming.

A line the client invents gets the id `optimistic:<variantId>`. The prefix is
the whole answer to "did the server give me this line, or did I make it up?" —
`isOptimisticLine` is a string test, no flag on the API type, and no client-only
field for the server response to collide with. Keying it on the variant rather
than a random id is what makes a second click merge into the line the first one
put there instead of appending a twin. The synthesized cart id, `optimistic:cart`,
falls out of the same rule.

A merge prices at the **line's** unit price, not the one just read off the
product page. The two can disagree — a sale that started mid-session, a stale
render — and the cart is what the shopper is buying at. A spec pins this.

A merged line keeps its server id, so its stepper and remove control stay live.
That is deliberate: the id addresses something, so an edit on it is valid. Only
the invented line freezes, and it freezes because there is nothing on the server
for the edit to name.

`useAddToCart` is its own hook rather than a sixth member of `useCartMutations`.
It is the only cart mutation a page outside the cart calls and the only one that
needs a product's display details, and the header and cart page were
constructing four mutations they never used to get at it.

Concurrency needed a guard the stepper never did, because two adds can be in
flight where two quantity edits of the same line cannot. Each add takes a
sequence number in `onMutate`; only the newest one writes the server's cart or
rolls back. Without it an older response landing last leaves the cart a unit
behind, and an older rollback wipes a newer estimate off the top of it. In-flight
cart reads are still cancelled before patching, as they are for the other two.

Two things changed that the ticket did not ask for, both found by using the app.

**The add button no longer disables while an add is in flight.** It did, which
meant a second quick click was swallowed — impossible to reconcile with "two
quick clicks add two units", and pointless once the cart already shows the first
unit. It disables only when no variant is selected.

**Dead-cart recovery never actually worked**, and this slice's checklist is where
that surfaced. `addToCartServerFn` caught the dead-cart error, called
`clearCartId()` and re-entered `getOrCreateCartId()` — but `getCookie` parses the
*request's* headers, so the deletion queued for the response was invisible to it
and the retry ran against the same dead id and failed the same way. Verified
against the running app: with a cart id the backend does not have, the add ended
in the error message, not a recovery. `session.ts` gained `replaceCartId`, which
mints a cart and repoints the cookie whatever the cookie currently says, and the
retry calls that. Same probe after the fix: the drawer opens, the badge reads 1,
no error.

The drawer's open state moved from the header into `CartUiProvider`, mounted in
`__root.tsx`. The header renders the drawer and the product page opens it, and
neither sits inside the other. It holds view state only — the cart itself is
still server state from `useCart`.

`AddToCartButton` now calls nothing at all: no query hook, no mutation hook, not
even `useState`. `justAdded` moved to the product page along with the mutation,
because the page is where the optimistic line's name, image and price already
are. It also renders the failure message, since the shopper is looking at the
button when the add fails.

Verified on two levels.

Twenty new specs in `utils.spec.ts` (36 in the file): a first add with no cart,
the zeros on a synthesized cart, appending, merging, the badge as a sum rather
than a doubled line, the merge priced at the line's own price, two clicks
compounding, the optimistic marker on invented lines and its absence on merged
ones, the discount carried across, the floor at zero, whole cents throughout,
and non-mutation of the cached cart it was handed.

Behaviourally, a throwaway WebDriver BiDi script (headless Firefox, scratch
directory, nothing committed) drove the real storefront against the real
backend, with a preload script patching `fetch` before the app's modules load so
each add could be delayed and one made to fail. Thirty-one checks, all passing:
the badge moves ~25ms after the click while the backend takes ~2s; the drawer
stays shut on the patch and opens only on the response; the invented line
renders name, variant, price and quantity with its controls frozen and
`data-optimistic` set; the server's cart leaves no remnant; a repeat variant
merges to one line reading 2; two quick clicks reach 4 and `/cart` agrees; a
failed add rolls the badge back exactly, shows the message, and opens no drawer;
and the stepper, removal and coupon field still behave as they did.

Two gaps. Adding while a coupon is applied is only covered by specs — this dev
store still has no coupon to apply, the same gap 02 left. And an add racing a
stepper edit on the *same* merged line is unspecified: both write the cart they
get back, so the later response wins, which is the pre-existing behaviour of
those two mutations and not something this slice changed.
