# Storefront editing bridge

`ie.js` — the storefront half of Inline Editing. It marks the regions a page
declares, announces them to the admin, and applies the previews the admin
pushes back. It renders no editing UI, holds no credential, and saves nothing.

**The contract is documented in
[`docs/inline-editing-protocol.md`](../../docs/inline-editing-protocol.md)** —
data attributes, the message set, versioning, the origin rules, and how to
embed the script. That document is what an integrator implements against; this
one is about the package.

Version 4 covers the copy fields of a product and a category, the Content Slots
a storefront declares, and the frame announcing where it has navigated to.

## Layout

| File                   | What it is                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/protocol.ts`      | The protocol as pure functions and constants: parsing, validation, limits. Imported by the bridge and by the admin. |
| `src/ie.ts`            | The bridge itself — the only part that touches a DOM. Built to a minified IIFE.                                     |
| `src/protocol.spec.ts` | Units over untrusted input: every refusal the protocol makes, asserted on returned values.                          |

`protocol.ts` is exported as `@repo/inline-edit-js/protocol` so the admin and
the Starter Storefront validate against the same source as the bridge, and the
numbers in the contract document have one definition.

## Working on it

```sh
npm run build --workspace @repo/inline-edit-js   # dist/ie.js, minified IIFE
npm run dev   --workspace @repo/inline-edit-js   # rebuild on change
npm test      --workspace @repo/inline-edit-js   # pure protocol specs
```

The backend serves the built artifact at `/ie.js` with a content ETag, just
like `/ca.js`; build this package before starting the backend, or run its `dev`
task while working on the bridge.

Backend persistence and permission coverage lives in
`apps/backend/test/inline-edit.e2e-spec.ts` and
`apps/backend/test/content-slots.e2e-spec.ts`. There are deliberately no
component tests and nothing that drives a real iframe: the editing chrome is
UI, and the parts worth testing are the refusals, which are pure.

Changing anything in `protocol.ts` that a storefront can observe — the message
set, a field, a limit, an attribute — means bumping `VERSION` and updating the
contract document in the same change.
