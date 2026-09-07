# 02: The rest of the editable text

**What to build:** Every field that carries the merchant's words is reachable
from the page it appears on — product description and SEO copy, category name
and description — not just the product name.

The description is where in-place editing earns its keep. It is the field a
merchant currently writes blind into a textarea and verifies by opening another
tab, and the one whose length and wrapping only make sense against the gallery
it sits beside.

Category fields matter for a second reason: they prove the protocol is not
product-shaped. An editable region names an entity kind, an id, and a field, and
a category is the first evidence that the kind is a real dimension rather than a
constant.

All of it saves through the endpoints and permissions these fields already have.
No new write path, and no permission a form does not already require.

**Blocked by:** 01 (Edit a product name in place).

**Status:** resolved

- [x] Product description is editable in place, with multi-line editing that behaves sensibly for a paragraph rather than a single line
- [x] Product SEO title and SEO description are editable in place
- [x] Category name and category description are editable in place on a listing page
- [x] Each field saves through the endpoint and permission it already has in the admin
- [x] Committing, abandoning, and failure behave identically to the product name — one editing behaviour, learned once
- [x] A field the merchant's role cannot edit is not offered as editable
- [x] An oversized paste is refused with a message that says so, rather than silently truncating
- [x] Pasted content is stored as text; markup pasted from a word processor cannot enter the Store through the editor

## Comments

Protocol version 2. A target is now `<kind>:<uuid>:<field>` over two kinds:
`product` (name, description, seoTitle, seoDescription) and `category` (name,
description), each field carrying its own label, length limit and whether it is
a paragraph. Every value is bounded by its own field rather than by one global
limit, so a 5000-character description and a 255-character name can share a
message. A `Region` may now carry `rect: null`.

`rect: null` is what makes SEO copy reachable. The Starter Storefront declares
`seoTitle` and `seoDescription` in a hidden element on the product page — only
inside an editing session, so a shopper's page carries neither — and the admin
offers every announced region, geometry or not, in an **Editable on this page**
list beside the frame. Clicking a visible region still works exactly as before;
the list is how a merchant reaches a field the page has no text for. The
product route now also renders those fields into its head, so the SEO copy the
merchant edits is copy the Store actually uses.

Category name and description are declared on `/products?category=<slug>` — the
selected category's heading and the description beneath it, which the listing
page now renders. The sidebar links stay links: turning navigation into an edit
would have cost more than it bought.

Both entity kinds save through the endpoints and permission they already had —
`PATCH /api/admin/products/:id` and `PATCH /api/admin/categories/:id`, both
under `products.update`, so a support agent is offered nothing and refused if
they ask anyway. Committing, abandoning and failure are one code path for all
six fields. A rename still regenerates the slug through the existing endpoint,
so the editor reopens the saved page at its new address — now for a category as
well as a product.

Copy stays text. The editor reads `text/plain` from the clipboard, normalises
line endings, drops unrenderable control characters, keeps a single-line field
free of newlines, and refuses an oversized paste whole rather than trimming it.
Nothing parses markup: a preview is applied with `textContent` and the stored
string is rendered as characters.

Validation: 57 protocol specs, 64 storefront specs, 263 backend unit specs, and
the full backend integration suite — 157 tests across 8 suites, including nine
inline-edit cases — passed against local Postgres. Frontend, storefront and
backend builds and TypeScript checking passed. Backend lint still reports the
five pre-existing failures it reported before this change, none in files touched
here. The integration suite needed a local `apps/backend/.env.test.local`, which
was removed afterwards so the checkout's environment files are as they were.
Per this stage's testing decisions, no component or iframe automation was added.
