# 04: The homepage hero as a Content Slot

**What to build:** The merchant edits the headline above the fold on their
homepage. Today that text lives in the storefront's config file, which means
seasonal copy on the most valuable piece of text on the Store requires someone
who can edit TypeScript and redeploy.

This is the second tracer bullet: the first Content Slot, end to end. A Slot is a
named, Store-scoped region the storefront renders at a stable key —
`homepage.hero` — holding typed content. It is **not a page** and is **not
composed of arbitrary nested blocks**. Nothing in this ticket should make a page
builder easier to add by accident.

A Slot edit behaves differently from a product field edit, deliberately: it saves
as a **draft** and is published separately, so the merchant can write next week's
promotion without it appearing today, and so editing never blanks a live region.
The published value keeps rendering to shoppers throughout. The two behaviours
differ and the UI has to make which is which unmistakable — an editor where some
changes are live and some are not, and which does not say which, is worse than
one with a single behaviour.

**The failure this ticket is engineered against is a draft reaching a shopper.**
Every other mistake here is visible and reversible; a merchant's unfinished words
appearing on their live Store, discovered by a customer rather than by them,
cannot be un-shown. The public read returns published values only, and there is
no argument to it that changes that.

**Blocked by:** 01 (Edit a product name in place).

**Status:** ready-for-agent

- [ ] A `content_slots` table exists, tenant-scoped with `organization_id` as its second column and also scoped by `store_id`, holding the Slot key, its content type, the published value, the draft value, a status, when it was last published, and timestamps
- [ ] The Slot key is unique per Store; the same key in two Stores is two different Slots
- [ ] There is deliberately **no version history** — a Slot holds what is published and what is being drafted, and nothing else
- [ ] Slot content is stored as text, never as markup
- [ ] New `content.read` and `content.write` permissions exist, following the shape the discounts and campaigns permissions already use — available to super admins and product managers, not to support agents
- [ ] Admin endpoints list a Store's Slots, save a draft, and publish, guarded by those permissions
- [ ] The public storefront GraphQL read returns a Store's Slots with **published values only**, guarded by the existing storefront API-key auth
- [ ] `products` and `categories` gain no new columns
- [ ] The Starter Storefront declares `homepage.hero` — key, type, and a human label — renders its published value, and announces it to the editor
- [ ] A Slot with no published value renders nothing on the live Store, rather than placeholder text
- [ ] The merchant edits the hero in place in the editor, sees their draft in the frame, and publishes it deliberately
- [ ] The published value keeps rendering to shoppers while a draft exists
- [ ] The UI states plainly that a Slot edit is drafted until published, where the merchant is working
- [ ] End-to-end coverage in the existing backend harness: a Slot with a draft and no published value is absent from the public read; a Slot with both returns the published value and never the draft; no argument to the public read exposes a draft; publishing makes the drafted value public; a Slot in one Store is invisible to another Store's API key; and saving a draft and publishing both require `content.write`, with a support agent refused
