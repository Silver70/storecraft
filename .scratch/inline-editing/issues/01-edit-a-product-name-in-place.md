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

**Status:** resolved

- [x] A new workspace package holds the storefront-side edit script, built to a minified IIFE, in the same shape as the analytics tracker package
- [x] The backend serves that script at a root path, the way it already serves the analytics tracker
- [x] The Starter Storefront marks its product name as an editable region with data attributes, and embeds the script only when a session calls for it
- [x] The admin has an editor surface that renders the Store in a frame, resolving the URL from the backend's existing storefront address rather than a second configured one
- [x] Editable text is outlined on hover, and clicking it starts an edit in place
- [x] The value updates live in the frame as the merchant types, pushed in by the admin
- [x] Committing is deliberate; a stray click does not save
- [x] Abandoning an edit restores the original
- [x] A commit saves through the **existing** admin product endpoint — no new write path for a field that already has one
- [x] The save is subject to `products.update`; a support agent cannot edit through the editor
- [x] A failed save tells the merchant, leaves the typed text on screen to retry, and leaves the stored value untouched
- [x] Every message carries an explicit protocol version, and an unrecognised version is refused — loudly in the admin, silently in the storefront
- [x] Both sides verify origin: the storefront accepts messages only from the configured admin origin, the admin only from the frame it opened
- [x] An editable region is identified by entity kind, id, and field — never by position on the page
- [x] Nothing in the protocol writes; the frame holds no credential and never calls the commerce API to persist
- [x] The script is inert outside an editing session and absent from an ordinary shopper's page
- [x] The protocol's pure functions have unit specs in the new package: an unexpected origin refused, an unknown version refused, a malformed or partial payload refused, a valid message parsed to its command, a target descriptor parsed to entity kind / id / field, a malformed descriptor refused rather than guessed at, and an oversized payload refused


## Comments

Implemented the v1 product-name editing channel in `packages/inline-edit-js`,
served by the backend at `/ie.js`. The admin's **Store** surface and active
products' **Edit in Store** link open the backend-configured Store. The admin
owns the outline, anchored text input, draft, Save and Cancel. Preview messages
carry literal text only; saves use the existing product server function and
`PATCH /api/admin/products/:id`. Support agents receive a view-only surface.

The Starter Storefront declares the product-name target and loads the bridge
only inside a framed editing session. `ADMIN_ORIGIN` is configured on the
storefront (localhost:3000 by default in development); the asset address comes
from `COMMERCE_API_URL`. See `apps/storefront/README.md` and
`packages/inline-edit-js/README.md` for setup and the v1 contract.

Validation: frontend, storefront and backend builds passed; 41 protocol specs,
64 storefront specs and 263 backend unit specs passed. Full backend TypeScript
checking, including the new integration specs, passed. The integration suite
was attempted but stopped in global setup because this checkout's
`apps/backend/.env.test` is deleted and `DATABASE_URL` is unset. No integration
assertions ran; the existing environment-file deletions were preserved. The six
new integration cases cover public saved copy, retries, permissions, tenant and
Store isolation, editor bootstrap, and serving the script. UI/iframe automation
was not added, in accordance with this stage's testing decisions.
