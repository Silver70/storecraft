# 03: Navigate the Store and leave the editor

**What to build:** A merchant editing their Store walks around it. They click
from a product to its category, follow a link to the homepage, and keep editing
the whole way — the editor follows them rather than dropping them out.

Without this the editor can only change the page it opened on, which is not how
anyone edits a store. The merchant thinks in pages they can see, not in a list of
entities to pick from, and the whole argument for editing in place is that they
navigate to the thing they want to change.

Editing is a mode, so it needs a way out as well as a way in. It also needs to be
honest about where it is: the merchant should be able to see which page they are
looking at and open that page in a real tab, because checking your work outside
the editor is a normal thing to want.

This adds one message to the protocol — the frame announcing that it has
navigated, and re-announcing the editable regions of the page it landed on.

**Blocked by:** 01 (Edit a product name in place).

**Status:** resolved

- [x] Following a link inside the frame navigates the Store without leaving edit mode
- [x] The editable regions of the newly-loaded page are announced and become editable, with no reload of the admin
- [x] The merchant can see which page of their Store the frame is currently showing
- [x] The merchant can open the current page in a real tab, outside the editor
- [x] There is a clear way to leave editing and return to the normal admin
- [x] An edit committed before navigating is saved, not silently discarded by the navigation
- [x] The navigation message is versioned and origin-checked like every other message in the protocol
- [x] A navigation to something outside the merchant's own Store does not leave the editor believing it is still editing that Store

## Comments

Protocol version 3. One new frame event, `navigate`, carrying the address the
frame landed on — bounded at 2048 characters, http(s), no credentials — parsed
by the same `parseFrameMessage` as everything else, so origin, source window,
session, version, shape and size are checked identically. A `page` is now a
rendering of one address rather than of one document: the bridge mints a fresh
one on every move, so a `preview` or `focus` aimed at the page the merchant has
left lands on nothing.

The bridge only reports where it went. Whether that is still the merchant's
Store is the admin's question, answered by the new pure `locateInStore(url,
storefrontUrl)` against the Store the editor opened. Another origin, another
port, or a path above the Store's root returns `null`, and the editor stops
editing, says so, and offers **Return to your Store** rather than carrying on
as though it were still there. Once astray, only another navigation back into
the Store re-enables editing — a region announcement cannot. A page that
carries no bridge at all announces nothing, so a document load in the frame
also arms a wait; silence after one is treated the same way.

Navigation survives a whole new document, not only a client-side one. While a
session is open the bridge rewrites same-origin link addresses to carry
`?__commerce_edit=<session>` as the click happens, so a storefront that reloads
on every link — which is most storefronts that are not this one — stays in the
session. A router that handles the click itself never reads the rewritten
address. New tabs, downloads and modified clicks are left alone, and the marker
is inert outside a frame anyway.

The editor now says which page of the Store it is showing, opens that page in a
real tab at the address a shopper would use (`locateInStore` drops the session
marker), and has an **Exit editor** control back to the admin page it was
opened from — `returnTo`, confined by the route's own validation to a path
inside `/admin`, so leaving cannot become an open redirect — or the dashboard.

A save runs in the admin, on the admin's origin, so a navigation cannot cancel
one in flight: the page change leaves a saving draft alone and the save reports
as it always did. A draft that was never committed goes with the page it
belonged to, and the editor says that it did rather than dropping it quietly.
In practice the merchant cannot reach a link mid-edit — the draft panel covers
the frame — so this is the belt to that braces.

Validation: 76 protocol specs, 64 storefront specs and 263 backend unit specs
passed. Frontend, storefront, backend and bridge builds and TypeScript checking
passed. No backend code changed, so the integration suite is untouched by this;
it could not be run in this checkout, which has no `apps/backend/.env.test` and
no local Postgres. Backend lint reports nine pre-existing failures, none in a
file touched here. Per this stage's testing decisions, no component or iframe
automation was added.
