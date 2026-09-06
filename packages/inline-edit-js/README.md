# Storefront editing bridge

Build with `npm run build --workspace @repo/inline-edit-js`. The backend serves
the minified IIFE at `/ie.js`, with a content ETag, just like `/ca.js`.

Version 1 supports one text field:

```html
<h1 data-commerce-edit="product:33333333-3333-4333-8333-333333333333:name">
  Product name
</h1>
```

Only inside an admin editing frame, with `?__commerce_edit=<session UUID>` in
the URL, load the script with the same UUID and an explicitly configured admin
origin. Never derive the trusted origin from query parameters or messages.

```html
<script
  src="https://api.example.com/ie.js"
  data-admin-origin="https://admin.example.com"
  data-session="11111111-1111-4111-8111-111111111111"
></script>
```

An ordinary visit must omit the script. Even if included accidentally, it
returns before registering listeners or observers when there is no framed
session. A session UUID correlates messages; it grants no API permission.

Every envelope has `channel: "commerce-inline-edit"`, `version: 1`, `session`,
`page` (a UUID minted per frame document), and `type`. Frame events are `regions`
(identity, text and viewport rectangle), `hover`, and `select`. Admin commands
are `discover`, `preview` (identity and literal text), and `focus` (scroll to
identity). `preview` uses `textContent`; it never interprets HTML. Both receivers
validate the exact origin, source window, session, version and complete shape.
Commands also have to match the frame document. Unknown versions are ignored by
the bridge and reported by the admin. Envelopes are limited to 64 KiB, region
lists to 100, and product names to 255 UTF-16 code units. Duplicate declarations
of an identity preview together; the first visible occurrence supplies geometry.

The admin owns the draft, input, hover outline, Save and Cancel. No protocol
message saves anything. Only the deliberate admin action calls the existing
authenticated `PATCH /api/admin/products/:id`, under `products.update`.

Run the pure protocol specs with `npm test --workspace @repo/inline-edit-js`.
Backend persistence/permission specs are in `apps/backend/test/inline-edit.e2e-spec.ts`.
