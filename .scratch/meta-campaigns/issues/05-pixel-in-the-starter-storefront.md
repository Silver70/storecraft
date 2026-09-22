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

**Status:** ready-for-agent

- [ ] The storefront reads its Store's pixel id from the public API and loads
      the pixel; a Store with no connection loads nothing
- [ ] Disconnecting stops the pixel loading, without a storefront deploy
- [ ] Page views, product views and carts started are reported
- [ ] A Store-level consent switch exists, off by default, and is settable in
      the admin
- [ ] With the switch on, the Starter Storefront shows a consent banner and
      loads no pixel and reports nothing until the visitor accepts
- [ ] A visitor's answer persists across pages and sessions, and declining is as
      easy as accepting
- [ ] With the switch off, no banner appears anywhere
- [ ] The visitor's consent answer is readable by the checkout path, so ticket
      06 can honour it
- [ ] Meta's browser identifiers are captured and travel with the cart the way
      attribution already does, and are frozen onto the Order at checkout
- [ ] Capture failure is silent and never blocks a page, a cart or a checkout
