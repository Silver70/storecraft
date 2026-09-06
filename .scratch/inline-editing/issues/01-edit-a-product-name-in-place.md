# 01: Edit a product name in place

**What to build:** A merchant opens their Store inside the admin, hovers the
product name on a product page, clicks it, types a new one, commits it — and the
name is changed. The whole channel, end to end, for exactly one field.

This is the walking skeleton for the entire stage, and it stays whole because
neither half is verifiable alone: a protocol with nothing consuming it is not
demoable, and an editor with no protocol cannot run.

Per ADR-0003 the admin renders the storefront in a frame, the storefront marks
editable regions with data attributes and posts messages up, and the admin
renders every piece of editing chrome and owns draft state. The storefront
renders no editing UI of its own.

**Nothing in the protocol writes.** The frame is a rendering surface and an
event source; the save happens in the admin, on the admin's origin, through the
existing admin product endpoint under the existing `products.update` permission.
That is the security design, not an implementation detail — a frame that could
persist an edit would be a cross-origin page with write access to a tenant's
catalog. It also means entering through the editor grants nothing: a role that
cannot edit a product in a form cannot edit one on the page.

The storefront-side script ships as a workspace package built to a minified
IIFE and served by the backend at a root path, mirroring the analytics tracker
and `ca.js` exactly. That precedent is followed deliberately: it is how a
third-party storefront adopts a browser-side contract here, and it means an
integrator writes data attributes rather than a message handler.

Outside an editing session the script registers nothing, observes nothing, and
posts nothing — and is not on the page at all for an ordinary shopper.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A new workspace package holds the storefront-side edit script, built to a minified IIFE, in the same shape as the analytics tracker package
- [ ] The backend serves that script at a root path, the way it already serves the analytics tracker
- [ ] The Starter Storefront marks its product name as an editable region with data attributes, and embeds the script only when a session calls for it
- [ ] The admin has an editor surface that renders the Store in a frame, resolving the URL from the backend's existing storefront address rather than a second configured one
- [ ] Editable text is outlined on hover, and clicking it starts an edit in place
- [ ] The value updates live in the frame as the merchant types, pushed in by the admin
- [ ] Committing is deliberate; a stray click does not save
- [ ] Abandoning an edit restores the original
- [ ] A commit saves through the **existing** admin product endpoint — no new write path for a field that already has one
- [ ] The save is subject to `products.update`; a support agent cannot edit through the editor
- [ ] A failed save tells the merchant, leaves the typed text on screen to retry, and leaves the stored value untouched
- [ ] Every message carries an explicit protocol version, and an unrecognised version is refused — loudly in the admin, silently in the storefront
- [ ] Both sides verify origin: the storefront accepts messages only from the configured admin origin, the admin only from the frame it opened
- [ ] An editable region is identified by entity kind, id, and field — never by position on the page
- [ ] Nothing in the protocol writes; the frame holds no credential and never calls the commerce API to persist
- [ ] The script is inert outside an editing session and absent from an ordinary shopper's page
- [ ] The protocol's pure functions have unit specs in the new package: an unexpected origin refused, an unknown version refused, a malformed or partial payload refused, a valid message parsed to its command, a target descriptor parsed to entity kind / id / field, a malformed descriptor refused rather than guessed at, and an oversized payload refused
