# Storefront editing bridge

Build with `npm run build --workspace @repo/inline-edit-js`. The backend serves
the minified IIFE at `/ie.js`, with a content ETag, just like `/ca.js`.

Version 4 covers the copy fields of two entity kinds, the Content Slots a
storefront declares, and the frame announcing where it has navigated to. An
editable region names what it is — kind, id, field, or a Slot key — never where
it sits:

| Kind       | Fields                                              | Limits (UTF-16 units) |
| ---------- | --------------------------------------------------- | --------------------- |
| `product`  | `name`, `description`, `seoTitle`, `seoDescription` | 255, 5000, 255, 500   |
| `category` | `name`, `description`                               | 255, 2000             |

```html
<h1 data-commerce-edit="product:33333333-3333-4333-8333-333333333333:name">
  Product name
</h1>
```

## Content Slots

A Content Slot is a named region **your storefront** renders at a stable key,
holding copy the merchant edits in the admin instead of in your source. You
declare which Slots exist; the merchant is offered those and cannot invent
others. A Slot is not a page and is not composed of nested blocks.

Mark it with `slot:<key>` and declare its content type and a human label. A key
is lowercase words separated by dots or dashes, at most 64 characters:

```html
<h1
  data-commerce-edit="slot:homepage.hero"
  data-commerce-slot-type="heading"
  data-commerce-slot-label="Homepage headline"
>
  Winter kit, ready when you are.
</h1>
```

| Type      | Shape          | Limit |
| --------- | -------------- | ----- |
| `heading` | one line       | 120   |
| `text`    | multiple lines | 2000  |

A Slot marked without a type and label the protocol recognises is not announced
at all, because the admin would have no honest way to offer it.

Read the published values from the public storefront GraphQL API:

```graphql
query {
  contentSlots {
    key
    type
    value
  }
}
```

That read returns **published values only**, and takes no argument that would
change it — the public type has no draft field. Render a Slot with no published
value as **nothing**: no placeholder, no fallback headline. Render the element
anyway inside an editing session so the merchant can find and fill a region
that currently shows nothing.

Unlike an entity field, a Slot edit is saved as a draft, and published or
discarded separately. The admin holds the draft and pushes it into your page as
a `preview`; your Store keeps rendering the published value, so nothing you do
here can put unfinished copy in front of a shopper, and discarding a draft
leaves that published value exactly where it was.

A Slot's content type is fixed by the declaration it is first saved with, and
every later write is measured against it — a `heading` Slot refuses `text`
content rather than handing your page something it has no layout for. Give a
region whose shape genuinely changes a new key: the copy written for a headline
is not the copy for a paragraph.

A region the page declares but does not display — SEO copy, say — is announced
with `rect: null` and offered by the admin in a list rather than outlined. Mark
it on an element the shopper's page does not show, and declare a field that is
currently empty so the merchant can find and fill it:

```html
<div hidden>
  <span data-commerce-edit="product:3333…:seoTitle">Buy the thing</span>
</div>
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

Every envelope has `channel: "commerce-inline-edit"`, `version: 4`, `session`,
`page` (a UUID minted for each address the frame shows), and `type`. Frame
events are `navigate` (the address the frame has landed on), `regions`
(identity, text, viewport rectangle — `null` for a region with no geometry —
and the Slot declaration, `null` for an entity field), `hover`, and `select`. Admin commands are `discover`, `preview`
(identity and literal text), and `focus` (scroll to identity). `preview` uses
`textContent`; it never interprets HTML. Both receivers validate the exact
origin, source window, session, version and complete shape. Commands also have
to match the frame document. Unknown versions are ignored by the bridge and
reported by the admin. Envelopes are limited to 64 KiB, region lists to 100
entries and 32 KiB of text, and every value to the limit of its own field.
Duplicate declarations of an identity preview together; the first occurrence
that renders supplies the geometry.

## Navigating the Store

The merchant walks around the Store inside the frame, and editing follows. On
arrival and on every move the bridge mints a fresh `page`, sends `navigate`
with `location.href` (bounded at 2048 characters, http(s), no credentials), and
re-announces the regions of the page it landed on. A command addressed to the
page the merchant has left therefore lands on nothing.

The bridge only reports where it went. Whether that address is still the
merchant's Store is the admin's question, answered by `locateInStore(url,
storefrontUrl)` against the Store the editor opened: a different origin, or a
path above the Store's root, returns `null`, and the admin stops editing rather
than carrying on as though it were still that Store. `locateInStore` also drops
the session marker, so the address the admin offers for opening in a real tab
is the address a shopper would use.

So that a link which loads a whole new document lands in the same session — on
a storefront that is not a single-page app, that is every link — the bridge
rewrites same-origin link addresses to carry `?__commerce_edit=<session>` as
the click happens. A storefront whose router handles the click itself navigates
in place and never reads the rewritten address, so this costs it nothing. A
link opening a new tab, a download, and a modified or non-primary click are all
left alone.

Copy is text throughout. `sanitizeText` normalises line endings, drops control
characters, and keeps a single-line field free of newlines; `applyPaste`
refuses an oversized paste outright rather than truncating it. Neither strips
markup, because nothing parses it: a preview is applied with `textContent` and
the storefront renders the stored string as characters. A Slot goes further —
the backend reduces whatever was pasted to its text before storing it, so a
Store cannot acquire markup through its own CMS.

The admin owns the draft, input, hover outline, Save, Publish, Discard and
Cancel. No protocol message saves anything. Only the deliberate admin action
calls the existing authenticated `PATCH /api/admin/products/:id` or
`PATCH /api/admin/categories/:id`, both under `products.update`, or
`PUT /api/admin/content/slots/:key/draft`,
`POST /api/admin/content/slots/:key/publish` and
`DELETE /api/admin/content/slots/:key/draft`, all under `content.write`.

The admin also owns the way out: it shows which page of the Store the frame is
displaying, offers it in a real tab, and has an **Exit editor** control that
returns to the admin. Nothing about leaving is the storefront's business.

Run the pure protocol specs with `npm test --workspace @repo/inline-edit-js`.
Backend persistence/permission specs are in
`apps/backend/test/inline-edit.e2e-spec.ts` and
`apps/backend/test/content-slots.e2e-spec.ts`.
