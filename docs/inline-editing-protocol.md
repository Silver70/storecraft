# Inline Editing protocol

**Version 4.** This is the contract between the Commerce OS admin and any
storefront that wants to be visually editable. Implement it and a merchant can
open your Store inside the admin, click the copy they see, and change it — with
no editing UI of your own, and no code from us beyond one script tag.

Two things make a storefront editable:

1. **Mark the regions.** Put a `data-commerce-edit` attribute on the elements
   whose text a merchant may change.
2. **Embed the bridge.** Load `/ie.js` from the commerce backend, but only in a
   framed editing session.

Everything else — the outline on hover, the input, Save, Cancel, Publish, the
draft — belongs to the admin. Your storefront renders no editing chrome and
holds no editing state.

`apps/storefront`, the Starter Storefront, is the worked reference
implementation: it exercises every part of this document. This page is the
contract; that app is what it looks like in a real codebase. You should not
need to read it to finish an integration — [Reference
implementation](#reference-implementation) says which file to open if you want
to anyway.

- [Quick start](#quick-start)
- [Marking editable regions](#marking-editable-regions)
- [Content Slots](#content-slots)
- [Embedding the bridge](#embedding-the-bridge)
- [The message set](#the-message-set)
- [Versioning](#versioning)
- [Origins and trust](#origins-and-trust)
- [Nothing in the protocol writes](#nothing-in-the-protocol-writes)
- [Limits](#limits)
- [Deliberately absent](#deliberately-absent)
- [Conformance checklist](#conformance-checklist)
- [Troubleshooting](#troubleshooting)

## Quick start

Configuration, once:

| Where            | Setting          | Value                                                                                                              |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Commerce backend | `STOREFRONT_URL` | Your Store's public address. The admin opens the frame here.                                                       |
| Your storefront  | admin origin     | The exact origin of the admin — `https://admin.example.com`. Server-side configuration, never inferred at runtime. |
| Your storefront  | script origin    | The commerce API origin. The bridge is served at `<api origin>/ie.js`.                                             |

Then, in your page:

```html
<!-- 1. Mark what may be edited. -->
<h1 data-commerce-edit="product:33333333-3333-4333-8333-333333333333:name">
  Trail Runner 3
</h1>

<!-- 2. In a framed editing session only, load the bridge. -->
<script
  src="https://api.example.com/ie.js"
  data-admin-origin="https://admin.example.com"
  data-session="11111111-1111-4111-8111-111111111111"
></script>
```

A page is in an editing session when **both** hold:

- the document is framed (`window.parent !== window`), and
- its URL carries `?__commerce_edit=<session UUID>`, matching `data-session`.

The admin puts that parameter on the frame's address. Outside a session, omit
the script entirely — see [Embedding the bridge](#embedding-the-bridge).

That is the whole integration for entity fields. [Content
Slots](#content-slots) add regions of your own choosing.

## Marking editable regions

A region names **what it is**, never where it sits on the page. A message that
arrives after a re-render lands on the right thing or on nothing at all.

```
data-commerce-edit="product:<uuid>:<field>"   an entity field
data-commerce-edit="category:<uuid>:<field>"  an entity field
data-commerce-edit="slot:<key>"               a Content Slot
```

At most 128 characters. A descriptor that does not parse is ignored — the
region is not announced, and no guess is made about what was meant.

### The fields you may mark

| Kind       | Field            | Shape          | Limit (UTF-16 units) |
| ---------- | ---------------- | -------------- | -------------------- |
| `product`  | `name`           | one line       | 255                  |
| `product`  | `description`    | multiple lines | 5000                 |
| `product`  | `seoTitle`       | one line       | 255                  |
| `product`  | `seoDescription` | multiple lines | 500                  |
| `category` | `name`           | one line       | 255                  |
| `category` | `description`    | multiple lines | 2000                 |

This table is closed. A kind or field outside it is not part of version 4, and
a region naming one is ignored rather than offered. The limits are the
editor's, not the database's: those columns are unbounded text, and an editing
channel that accepts an unbounded paste is a broken page waiting to happen.

The `<uuid>` is the entity's id as the commerce API returns it, lowercase or
upper, in canonical hyphenated form.

### What to mark

Mark the element whose `textContent` is that field's value **and nothing
else**. The bridge announces `textContent` as the region's current value, and a
preview is applied by assigning to `textContent`. An element wrapping the value
plus a label, a price, or an icon will announce all of it and lose the rest on
the first preview.

```html
<!-- Good: the element holds the field and only the field. -->
<h1 data-commerce-edit="product:3333…:name">Trail Runner 3</h1>

<!-- Wrong: the badge is inside the region and would be overwritten. -->
<h1 data-commerce-edit="product:3333…:name">Trail Runner 3 <span>New</span></h1>
```

**A region with no geometry is still editable.** SEO copy has nothing on the
page to click; a description a merchant has not written yet renders as nothing.
Declare them anyway, on an element the shopper's page does not display, and the
admin offers them in a list instead of outlining them:

```html
<div hidden>
  <span data-commerce-edit="product:3333…:seoTitle"
    >Trail Runner 3 — Example</span
  >
  <span data-commerce-edit="product:3333…:seoDescription"></span>
</div>
```

**The same field may be marked more than once.** Every occurrence previews
together; the first one that actually renders supplies the outline's geometry.

**Regions are announced per page, not per site.** A page announces the regions
in its own document, up to the caps in [Limits](#limits). Beyond them, the
extra regions are dropped rather than the message.

## Content Slots

A Content Slot is a named region **your storefront** renders at a stable key —
`homepage.hero`, `plp.banner` — holding copy the merchant edits in the admin
instead of in your source. You declare which Slots exist; the merchant fills in
those and cannot invent others.

A Slot is not a page, and is not composed of nested blocks. That is the line
that keeps this a CMS for regions a storefront chose to render rather than a
page builder.

### Declaring one

Mark it like any other region, and add the two attributes that say how to edit
it:

```html
<h1
  data-commerce-edit="slot:homepage.hero"
  data-commerce-slot-type="heading"
  data-commerce-slot-label="Homepage headline"
>
  Winter kit, ready when you are.
</h1>
```

| Attribute                  | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `data-commerce-edit`       | `slot:<key>` — lowercase words joined by `.` or `-`, at most 64 chars |
| `data-commerce-slot-type`  | The shape of its content: `heading` or `text`                         |
| `data-commerce-slot-label` | What to call the region in front of the merchant, 1–60 characters     |

| Type      | Shape          | Limit |
| --------- | -------------- | ----- |
| `heading` | one line       | 120   |
| `text`    | multiple lines | 2000  |

The type set is closed for the same reason the field table is: the type is what
lets the admin offer the right editor and bound the paste, and a Slot your page
cannot render is worse than one the merchant cannot fill. **A Slot marked
without a type and label the protocol recognises is not announced at all** —
the admin would have no honest way to offer it, and guessing a shape is how a
Slot ends up holding something your layout has no room for.

Keep the declarations in one place in your source. Adding a Slot is an entry
plus a rendered region; removing one is deleting both, because a key nobody
renders is a Slot nobody can find.

### Reading the published values

Published Slot values come from the public storefront GraphQL API, under the
API key that already identifies your Store:

```graphql
query {
  contentSlots {
    key
    type
    value
  }
}
```

It takes **no arguments**, and the public type has no draft field. Published
values only is not a default here, it is the whole surface: there is nothing to
pass that would widen it.

### Rendering rules

- **A Slot with no published value renders nothing.** No placeholder, no
  fallback headline. An unconfigured Store shows shoppers no scaffolding.
- **In an editing session, render the marked element anyway**, empty. That is
  the only difference between the two, and it is what lets a merchant find and
  fill a region that currently shows nothing at all. Outside a session your
  code need never ask whether one is running.
- **Render the published value, always.** The merchant's draft arrives as a
  `preview` message and is put into the DOM by the bridge. Nothing in your code
  fetches a draft, and no API would return one.

### Drafts, and the asymmetry

An **entity field** edit is live the moment the merchant saves it — it is the
same write the admin form performs.

A **Slot** edit is saved as a draft and published separately. Your Store keeps
rendering the published value until the merchant publishes, so editing never
blanks a live region, and discarding a draft leaves the published value exactly
where it was. Nothing you do can put unfinished copy in front of a shopper.

A Slot's content type is fixed by the declaration it is first saved with, and
every later write is measured against it: a `heading` Slot refuses `text`
content rather than handing your page something it has no layout for. Give a
region whose shape genuinely changes a **new key** — the copy written for a
headline is not the copy for a paragraph.

## Embedding the bridge

```html
<script
  src="https://api.example.com/ie.js"
  data-admin-origin="https://admin.example.com"
  data-session="11111111-1111-4111-8111-111111111111"
></script>
```

| Attribute           | Value                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `src`               | `<commerce API origin>/ie.js`. Public, unauthenticated, cached with an ETag.                            |
| `data-admin-origin` | The exact admin origin — scheme, host, port; no path, no trailing slash. **Configured, never derived.** |
| `data-session`      | The session UUID from the frame URL's `__commerce_edit` parameter.                                      |

**Load it as a plain script tag.** The bridge reads its configuration from its
own element via `document.currentScript`, so it must be a classic `<script>`
with those attributes — an ES module import, a bundled copy, or a tag whose
attributes are set after it starts loading gets no configuration and does
nothing. `defer` is fine. Load it once per document; a second copy is a second
bridge announcing the same regions.

**Ship it only inside an editing session.** An ordinary visit should not
download it: editing capability is not something a shopper's browser needs to
fetch. Render the tag on the server when the request carries the session
parameter, or inject it on the client after checking, whichever suits your
framework.

**It is inert if it is loaded anyway.** Before registering anything, the bridge
returns unless all of these hold: the document is framed, `data-admin-origin`
parses as an http(s) origin, `data-session` is a UUID, and the current URL's
`__commerce_edit` parameter equals it. Outside a session it registers no
listener, observes nothing, and posts nothing. Failing to load it must never
break your Store — a missing asset should leave the page working and let the
admin report the failed connection.

The session UUID **correlates messages within one editing session and grants
nothing.** It is not a credential, it is not accepted by any API, and a leaked
one buys an attacker nothing that the origin checks do not already refuse.

### Navigation

The merchant walks around the Store inside the frame, and editing follows. On
arrival and on every move the bridge announces where it went and re-announces
the regions of the page it landed on. The admin decides whether that address is
still the merchant's Store; a page at another origin, or above the Store's
root, pauses editing rather than leaving the editor believing it is still on
your Store.

So that a link which loads a whole new document lands in the same session — on
a storefront that is not a single-page app, that is every link — the bridge
rewrites same-origin link addresses to carry `?__commerce_edit=<session>` as
the click happens. A router that handles the click itself navigates in place
and never reads the rewritten address, so this costs it nothing. Links opening
a new tab, downloads, and modified or non-primary clicks are left alone.

Your storefront must tolerate the extra query parameter on any URL. Do not
route on it, and do not emit it in canonical URLs, `<link rel="canonical">`, or
sitemaps.

### Deployment

The admin renders your Store in an iframe, so your storefront must permit
framing by the admin origin: `Content-Security-Policy: frame-ancestors
https://admin.example.com`, and no `X-Frame-Options: DENY`. If your CSP
restricts `script-src`, allow the commerce API origin.

## The message set

Every message is a `window.postMessage` payload with this envelope:

| Field     | Value                                                   |
| --------- | ------------------------------------------------------- |
| `channel` | `"commerce-inline-edit"`                                |
| `version` | `4`                                                     |
| `session` | The session UUID both sides agreed on via the frame URL |
| `page`    | A UUID identifying one rendering of one address         |
| `type`    | The command name                                        |

plus that command's own fields, and **no others**. An envelope with an extra
key is refused as malformed rather than read past.

`page` is minted by the bridge on load and again on every navigation. The admin
echoes back the page it is answering, and the bridge drops any command whose
`page` is not the one on screen — a command aimed at the page the merchant has
left lands on nothing.

### Frame → admin

| Type       | Fields                          | Meaning                                                                       |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `navigate` | `url`                           | The address the frame has landed on. Absolute http(s), no credentials.        |
| `regions`  | `regions[]`                     | Every editable region on this page, with its current text and geometry.       |
| `hover`    | `target` (descriptor or `null`) | The pointer entered or left a region.                                         |
| `select`   | `target`                        | The merchant clicked a region. The bridge suppresses the page's own handling. |

A `regions` entry is exactly:

| Field    | Value                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| `target` | The descriptor, unique within the message                                                  |
| `value`  | The region's current text, bounded by that region's own limit                              |
| `rect`   | `{ x, y, width, height }` in viewport coordinates, or `null` for a region with no geometry |
| `slot`   | `{ type, label }` for a Content Slot; `null` for an entity field                           |

### Admin → frame

| Type       | Fields            | Meaning                                                    |
| ---------- | ----------------- | ---------------------------------------------------------- |
| `discover` | —                 | Re-announce this page's regions.                           |
| `preview`  | `target`, `value` | Show this text in that region. Applied with `textContent`. |
| `focus`    | `target`          | Scroll that region into view.                              |

### The set is closed

Those seven commands are the whole protocol at version 4. **A message outside
the set is ignored** — not logged as an error by your storefront, not answered,
not partially handled. So is a message of a known type carrying unexpected
fields, a missing field, a field of the wrong type, or a value longer than its
region's limit.

Do not send messages of your own on this channel, and do not depend on the
absence of a message: the bridge is free to re-announce regions whenever the
page changes shape.

## Versioning

Every envelope carries `version: 4`. The version covers the whole public
surface described here — the envelope, the message set and their field shapes,
the data attributes, the descriptor grammar, the entity fields and Slot types
and their limits. A change to any of them that an existing implementation could
get wrong is a version bump.

**A receiver that does not recognise a version refuses the message.** The two
sides refuse it differently, on purpose:

- **The bridge refuses silently.** A storefront is a shopper-facing page and
  must never render an editor's error. Version-mismatched commands are dropped
  and the page keeps working.
- **The admin refuses loudly.** It stops the session and tells the merchant the
  Store's edit script is out of date, because the alternative is an editor that
  looks connected and quietly does nothing.

Neither side downgrades, negotiates, or attempts a partial read of an
unrecognised version. There is no compatibility mode.

**Staying current.** If you load `/ie.js` from the commerce backend, as the
snippet above does, the version follows the engine you are talking to and there
is nothing to upgrade. If you vendor a copy of the script, re-fetch it whenever
the engine is upgraded; a stale copy will announce an old version and the admin
will say so. Your `data-*` attributes are part of the same contract — check
this document when the version changes rather than assuming the attributes
survived it.

## Origins and trust

This is an editing channel into a live storefront. A page that can post into it
can change what the merchant sees and therefore what they save. Both sides
verify origin, and neither infers trust from the shape of a message.

**Your storefront accepts messages only from the admin.** The bridge compares
`event.origin` against the configured `data-admin-origin` and `event.source`
against `window.parent`, and refuses anything else before looking at the
payload.

**The admin accepts messages only from the frame it opened.** It compares the
origin against the storefront address it was configured with and the source
against that frame's window, and posts with an explicit target origin, never
`*`.

**Configure the trusted origin; never derive it.** Not from a message, not from
a query parameter, not from `document.referrer`, not from `window.parent`. An
origin taken from anything the caller controls is not a check.

Every message that clears origin and source is then validated for channel,
session, protocol version, payload budget, page, exact shape and per-field
bounds — in that order, and completely, before any of it is acted on. Anything
that fails is refused whole; nothing is repaired or partially applied.

## Nothing in the protocol writes

**No message in this protocol saves anything.** The frame is a rendering
surface and an event source. Saving happens in the admin, on the admin's
origin, through the authenticated admin API, under the same permissions as the
admin forms:

| Written thing                | Endpoint                                                                                                                              | Permission        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Product field                | `PATCH /api/admin/products/:id`                                                                                                       | `products.update` |
| Category field               | `PATCH /api/admin/categories/:id`                                                                                                     | `products.update` |
| Slot draft, publish, discard | `PUT /api/admin/content/slots/:key/draft`, `POST /api/admin/content/slots/:key/publish`, `DELETE /api/admin/content/slots/:key/draft` | `content.write`   |

These are the same endpoints the admin forms use. Entering through the editor
grants nothing: a role that cannot edit a product in a form cannot edit one on
the page, and a support agent can edit neither copy nor Slots.

**The bridge holds no credential.** The script tag carries an admin origin and a
session UUID — no API key, no token, nothing that reaches the commerce API. Your
storefront's own API key must never be passed to it.

**Copy is text, never markup.** A `preview` is applied with `textContent`, so
markup can only ever be read as characters, never parsed. Slot values are
reduced to their text before they are stored, so a Store cannot acquire injected
markup through its own CMS. Render stored values as text; do not pass them
through an HTML renderer.

## Limits

| Bound                            | Value                                    |
| -------------------------------- | ---------------------------------------- |
| Envelope                         | 64 KiB serialized                        |
| Regions per `regions` message    | 100                                      |
| Total announced text per message | 32 KiB                                   |
| `navigate` URL                   | 2048 characters, http(s), no credentials |
| Target descriptor                | 128 characters                           |
| Slot key / Slot label            | 64 / 60 characters                       |
| Field value                      | The limit of that field or Slot type     |

Text entering a region is normalised before it is applied: line endings
collapse to `\n`, control characters no page can render are dropped, and a
single-line field never acquires a newline from a paste. **An oversized paste
is refused whole**, with a message, rather than truncated — a merchant is told
what happened instead of finding a sentence missing later.

The exported constants in `@repo/inline-edit-js/protocol` are the authoritative
copy of every number above.

## Reference implementation

The Starter Storefront in `apps/storefront` does everything on this page, in a
real app. Open it if you want to see a shape rather than a rule:

| For                                       | See                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| Declaring the Slots a Store renders       | `src/config/content-slots.ts`                              |
| Rendering a Slot, empty and filled        | `src/features/content/content-slot.tsx`                    |
| Session detection and script embed        | `src/features/inline-edit/use-inline-edit.ts`, `server.ts` |
| Marking entity fields, hidden SEO regions | `src/features/catalog/pages/`                              |

The protocol's own source and its unit specs live in
`packages/inline-edit-js/src/`. Nothing there is required reading for an
integration; it is where the numbers and the refusals are enforced.

## Deliberately absent

These are not oversights, and a proposal to add one is a design conversation
rather than a patch:

- **No layout editing.** No moving, resizing, styling, or reordering anything.
  A region's shape belongs to your storefront.
- **No page creation.** No routes, no page records, no navigation editing. The
  Store's pages are yours.
- **No version history.** A Slot holds one published value and one draft.
  There is no restore, no diff, no audit of previous copy.
- **No rich text.** Content is text. No HTML, no Markdown rendering, no
  formatting marks.
- **No localisation.** One value per Slot per Store. There is no locale
  dimension in the protocol or the storage.

Also outside version 4: editing images or media, editing prices, scheduled
publishing, shareable draft-preview links, and real-time collaboration. Last
write wins, exactly as the admin forms already behave.

## Conformance checklist

- [ ] `STOREFRONT_URL` on the backend points at the Store the admin should open.
- [ ] The admin origin is configured on the storefront, exactly, server-side.
- [ ] The bridge is embedded **only** when the document is framed and the URL
      carries a matching `__commerce_edit` session.
- [ ] It is a classic `<script>` tag carrying both data attributes, loaded once.
- [ ] An ordinary visit downloads no editing script and renders no editing markup.
- [ ] Editable elements carry `data-commerce-edit` and hold that field's text
      and nothing else.
- [ ] Regions with no visible text — SEO copy, empty descriptions — are declared
      anyway on undisplayed elements.
- [ ] Every Slot region carries a valid `slot:<key>`, `data-commerce-slot-type`
      and `data-commerce-slot-label`.
- [ ] A Slot with no published value renders nothing for shoppers, and renders
      its marked element in an editing session.
- [ ] Slot values are read from `contentSlots` and rendered as text.
- [ ] The storefront permits framing by the admin origin.
- [ ] An extra `__commerce_edit` query parameter changes no routing and appears
      in no canonical URL or sitemap.
- [ ] A failure to load `/ie.js` leaves the Store working.

## Troubleshooting

| Symptom                                             | Cause                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The admin says the Store never connected            | The script was not embedded, `/ie.js` did not load, or the frame is blocked by `frame-ancestors` / `X-Frame-Options`.                                       |
| The script loaded but the frame never says anything | It was imported as a module or bundled, so `document.currentScript` gave it no configuration; or `data-session` does not equal the URL's `__commerce_edit`. |
| The admin says the protocol version is unsupported  | A vendored `ie.js` is stale. Re-fetch it from the commerce API.                                                                                             |
| Nothing is outlined, but the frame loaded           | No region parsed: check the descriptor grammar and that the ids are real UUIDs.                                                                             |
| A Slot never appears in the editor                  | Its `data-commerce-slot-type` or `data-commerce-slot-label` is missing or not one the protocol recognises.                                                  |
| A region is offered in the list but never outlined  | It has no geometry on the page — expected for hidden or empty regions.                                                                                      |
| A preview wipes out part of the element             | The marked element holds more than the field. Mark the inner element that holds the value alone.                                                            |
| A save is refused as too long                       | The value exceeds the field's or Slot type's limit. Nothing was stored; the text stays on screen for a retry.                                               |
| Editing stops after following a link                | The link left the Store — another origin, or a path above the Store's root. The editor offers a way back.                                                   |
