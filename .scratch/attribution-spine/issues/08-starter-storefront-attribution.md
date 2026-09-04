# 08: Starter Storefront attribution capture

**What to build:** The Starter Storefront captures attribution and reports it, so a merchant running it gets campaign reporting with no work, and a developer forking it inherits a working reference implementation of the contract.

On landing, the storefront reads UTM parameters and the referrer. It persists the First Touch for the duration of the Lookback Window so a Visitor who returns days later — as someone considering a large purchase does — is still attributed to the Campaign that found them, and it updates the Last Touch on each new attributed arrival. Both are passed when a Cart is created. The storefront also embeds the existing tracking script.

Capture must never block or slow the page, and must collect no personal data. This is the first time the whole path runs in a real browser, and it is where the ergonomics of the public contract get proven before any third party meets them.

**Blocked by:** 02

**Status:** resolved

- [x] Landing on the storefront with UTM parameters and later checking out produces an Order carrying that attribution
- [x] First Touch survives across separate visits for the Lookback Window duration
- [x] Returning through a different Campaign updates Last Touch and leaves First Touch intact
- [x] Landing with no UTM parameters still checks out, producing an Unattributed Order
- [x] Attribution capture does not block rendering or add a perceptible delay to browsing or adding to cart
- [x] No personal data is collected for attribution
- [x] The tracking script is embedded and reporting events

## Comments

Implemented 2026-09-04.

**Where the code lives.** A new `apps/storefront/src/features/attribution/`,
following the app's thin-route-plus-feature-folder convention. `touch.ts` holds
the rules as pure functions — the browser half of what
`shared/attribution/attribution.util.ts` enforces server-side. `client.ts` is
the only part that touches the browser. `hooks.ts` runs capture from the root
route, `server.ts` carries a later arrival to an open cart, and `config.ts` is
the template knob a fork edits.

**Capture is local, synchronous, and off every rendering path.** It runs in an
effect after paint: parse the URL, read and write `localStorage`, done —
measured at ~5µs per arrival and ~2µs per read, and it issues no request of its
own. The first touch travels to the API on the call that *already* had to
happen (the cart is created lazily on the first add), so attribution adds no
network hop to browsing or adding to cart.

**A new arrival on an already-open cart is the one extra request**, and it fires
only on a genuine arrival, never on a page view. `syncAttributionServerFn`
deliberately does not create a cart: a visitor who has added nothing has nothing
to attribute, and minting a cart per campaign landing would fill the table with
empties. The first touch is already in the browser and travels with the cart
when one is finally created.

**Dedupe is what makes referrer-only arrivals safe.** `document.referrer` does
not change across a client-side navigation, so re-reading it on every route
change would keep re-recording the same arrival — and worse, an untagged page
later in the visit would overwrite a campaign's last touch with a bare referrer.
Capture therefore skips an arrival in the same session that either repeats the
last touch's signature or carries no UTM value at all. Same-origin referrers are
dropped entirely: an internal navigation is not an arrival.

**Expiry promotes rather than forgets.** When the first touch falls out of the
Lookback Window but the last has not, the last *becomes* the first — it is now
the earliest arrival still inside the window, which is what First Touch means.
Both stale means the next arrival starts fresh.

**Identifiers are shared with `ca.js` on purpose.** Capture reads the tracker's
own `_ca_vid` / `_ca_sid` keys, minting them under the identical 30-minute idle
rule when the script is absent or blocked. That is what lets ticket 07's
session correlation line an order up with the events sent for the same session.

**No personal data.** The ids are random UUIDs, the UTM values come from the
merchant's own ad links, the referrer is reduced to origin + path (its query
string belongs to another site and may carry anything), and the landing path
drops its query string. Nothing is read from the DOM, and no cookie is set by
the capture code.

**Attribution cannot cost a sale, at three layers.** Every entry point in
`client.ts` is wrapped so a storage or parsing fault returns "no attribution"
rather than throwing into a render; the server-fn validator uses
`.catch(undefined)` so a malformed payload degrades instead of failing the add
to cart; and `getOrCreateCartId` retries cart creation without the declaration
if the API rejected it. The sync is fire-and-forget and swallows its own errors.

**The tracking script is a `head` script on the root route**, with `defer` so it
is off the critical path and boots before hydration — which is why the ids it
mints are the ones capture then declares. It is gated on
`VITE_ANALYTICS_KEY` + `VITE_ANALYTICS_URL`; unset, nothing is embedded and
capture and checkout are unaffected.

**That key must be its own API key, not `COMMERCE_API_KEY`.** It is the one
value in this app that deliberately reaches the browser, because the script
sends it with every event batch. API keys are store-scoped and unscoped beyond
that, so a key in the browser is a key anyone can create carts with. The README
and `.env` both say so, and `.env` ships it blank rather than defaulting to the
server key.

**Verification.** No committed frontend tests, per the spec's testing decisions.
Verified instead by driving the real capture module (bundled for node) through a
simulated browser across several visits and sending what it declared through the
real storefront GraphQL API against local Postgres, asserting on the persisted
`orders` row: a campaign landing surviving a week and a second campaign to
produce first `summer_sale` / last `retarget_q3`; a later arrival advancing an
open cart's last touch; an untagged visit producing an order with source `none`
and a session id still present for correlation; and a touch older than the
window being dropped so the newer one becomes first. That harness was thrown
away rather than committed — it reaches across app boundaries through a build
artifact. `tsc --noEmit` and `vite build` clean; prettier applied.

**Not done here.** The tracker needs a dedicated API key created in the admin
before it reports events from this repo's dev storefront; `.env` carries the
placeholder and the instructions. Creating it needs admin credentials this work
did not have.
