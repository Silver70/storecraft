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

**Status:** ready-for-agent

- [ ] Product description is editable in place, with multi-line editing that behaves sensibly for a paragraph rather than a single line
- [ ] Product SEO title and SEO description are editable in place
- [ ] Category name and category description are editable in place on a listing page
- [ ] Each field saves through the endpoint and permission it already has in the admin
- [ ] Committing, abandoning, and failure behave identically to the product name — one editing behaviour, learned once
- [ ] A field the merchant's role cannot edit is not offered as editable
- [ ] An oversized paste is refused with a message that says so, rather than silently truncating
- [ ] Pasted content is stored as text; markup pasted from a word processor cannot enter the Store through the editor
