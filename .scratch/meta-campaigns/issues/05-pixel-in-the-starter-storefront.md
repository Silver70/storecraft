# 05: The Pixel in the Starter Storefront

**What to build:** Connecting Meta switches measurement on in the storefront. No
redeploy, no environment variable, no storefront configuration — the storefront
asks the API which pixel to load, and an unconnected Store serves none.

The pixel reports browsing: pages viewed, products viewed, carts started. That
is what lets the platform build retargeting audiences and gives it something to
learn from before a young store has many purchases. It also sets the browser
identifiers that ticket 06's server-side purchases are matched on, which is why
it comes first.

A Store selling where consent is required turns on a switch, and the storefront
then asks before it measures anything. The switch is off by default, so a store
that does not need a banner does not get one.

This is scheduled ahead of the campaign screens on purpose: the platform's
optimisation needs a warm dataset by the time campaigns start running.

**Blocked by:** 04

**Status:** resolved

- [x] The storefront reads its Store's pixel id from the public API and loads
      the pixel; a Store with no connection loads nothing
- [x] Disconnecting stops the pixel loading, without a storefront deploy
- [x] Page views, product views and carts started are reported
- [x] A Store-level consent switch exists, off by default, and is settable in
      the admin
- [x] With the switch on, the Starter Storefront shows a consent banner and
      loads no pixel and reports nothing until the visitor accepts
- [x] A visitor's answer persists across pages and sessions, and declining is as
      easy as accepting
- [x] With the switch off, no banner appears anywhere
- [x] The visitor's consent answer is readable by the checkout path, so ticket
      06 can honour it
- [x] Meta's browser identifiers are captured and travel with the cart the way
      attribution already does, and are frozen onto the Order at checkout
- [x] Capture failure is silent and never blocks a page, a cart or a checkout

## Comments

Done. Backend `tsc`, `npm test` (214 unit specs) and the new
`storefront-measurement.e2e-spec.ts` (13 specs) are green, as are the storefront
`vitest` run (75 specs) and both app builds. `npm run test:e2e` has 146 passing
and one failure — `inline-edit.e2e-spec.ts`, the same assertion tickets 01–04
each recorded, which asserts an exact object that has since gained
`canEditContent`. It does not touch measurement. `npm run lint` reports only the
same 7 pre-existing `unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`.

The storefront asks `measurementSettings` on every page and is told a pixel id
and whether to ask first. Nothing about measurement is configured in
`apps/storefront`: connecting writes the pixel id onto the connection,
disconnecting stops it being served, and neither is a deploy.

Judgement calls not on the checklist:

**The consent answer is frozen onto the Order, not merely readable.** The
checklist asks only that the checkout path can read it. It is stored the way the
touches are — declared on the cart, copied at checkout — because that is the
only form in which it is still readable when ticket 06 needs it, which is
minutes or hours after the sale, from a scheduled job with no cookie and no
browser. A cookie readable at checkout and nowhere afterwards would have made 06
rebuild this plumbing. `orders.measurement_consent` is nullable with exactly two
values and no third: null means the question was never put, not "unknown".

**`ca.js` is held back by the same answer.** Not on the checklist, which speaks
only of the pixel, but the ticket's own words are "asks before it measures
anything" — and a banner that blocks Meta while our own behavioural tracker
keeps recording devices, geography, clicks and form interactions is decoration.
The consequence is worth stating plainly: **a merchant who turns the switch on
loses their own analytics for every visitor who does not accept.** That is the
correct behaviour and it is also a change to something already shipped.

**The banner is shown whenever the switch is on, connection or not.** The first
version held it back until a pixel existed, on the reasoning that there is
nothing to consent to without one. That is wrong once `ca.js` is behind the same
answer: a store with the switch on and no ad account would have blocked its own
tracker forever while never asking anybody. The switch is the merchant saying
they need a banner; it is not conditional on Meta.

**The settings are loaded in the root route, not fetched from a component.** It
costs one small query per server-rendered page and buys two things worth more:
the tracking script can be left out of the HTML entirely rather than shipped and
asked not to run, and a visitor who answered last week does not watch a banner
flash while a client fetch resolves. A failure to read the settings returns
"measure nothing" rather than throwing — a storefront that could not find out
what it is allowed to do has no business assuming it may track anyone, and a
reporting concern must not be able to fail a page.

**Consent lives in a first-party cookie rather than `localStorage`.**
Attribution's own state is in `localStorage`, so this is a deliberate departure:
the answer has to be readable by the server that renders the page and by the
checkout path, and `localStorage` is invisible to both. It is one of two words,
it is not an identifier, and it is the one cookie a visitor who declined
everything still gets — the alternative being asked again on every page.

**We mint `_fbp` ourselves when the pixel has not, and never overwrite it.** A
visitor whose pixel is blocked still gets one stable browser id, so the
server-side purchase in ticket 06 has something to match on. Where the pixel
wrote its own we leave it exactly as it is: replacing it would make the server's
copy of a purchase look like a different person from the browser's. `_fbc` is
read from the landing URL at module load rather than when the settings arrive,
because a client-side navigation in between would have taken the `fbclid` with
it. A second landing with a *new* `fbclid` does replace it — that is a newer ad
click, and the same rule Last Touch follows.

**The measurement columns went into the attribution group rather than a table of
their own.** Same lifecycle, same freeze, same guarantee: written while the cart
is open, copied once at checkout, never written again. A parallel group would
have duplicated the patch, the copy and the tests to express a distinction that
changes no behaviour. `attribution.schema.ts` says so where a reader will find it.

**Checkout writes the answer once more before converting the cart.** The browser
declares it on every add and when the banner is answered, so this is the backstop
for the declaration that did not land. It costs one small mutation on a store
that asks for consent and nothing at all on a store that does not, because a
visitor who was never asked has no answer to send. It is wrapped and cannot fail
a checkout.

**Not done here, deliberately:** the browser-side `Purchase` event. Both copies
have to carry the Order id so the platform counts one purchase, which makes them
one decision rather than two, and ticket 06 is where that decision is made. This
ticket stops at the browsing events and at setting the identifiers 06 matches on.
