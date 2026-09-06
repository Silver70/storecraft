# Inline Editing and Content Slots

Status: ready-for-agent

Stage 4 of the product roadmap — the CMS. Implements ADR-0003 (Inline Editing
via an iframe postMessage protocol owned by the admin). Builds on the Starter
Storefront that Stage 3 finished.

## Problem Statement

The merchant can change everything about their Store except what it says.

Product copy can be edited, but only in an admin form, disconnected from the
page it appears on. The merchant writes a description into a textarea, saves,
opens the storefront in another tab, and discovers it runs three lines too long
under the gallery. Fixing it is another round trip. Every piece of copy on the
Store is written blind and verified by hand.

The homepage is worse: it cannot be changed at all. Its hero reads from the
storefront's config file, so the headline above the fold — the single most
valuable piece of text on the Store — is editable only by someone who can edit
TypeScript and redeploy. For a merchant running their own HVAC store, seasonal
copy means calling a developer. For an agency running a client's store, every
copy tweak is a ticket, a deploy, and a bill. There is no mechanism at all for
the banner on a listing page, the promotion strip, or any of the small pieces of
merchandising copy a store needs weekly.

The engine has spent three stages becoming very good at telling a merchant which
ad worked. It cannot yet let them change what the ad points at.

## Solution

The merchant opens their Store inside the admin and edits it where they see it.

The admin renders the storefront in a frame with an editing overlay. Editable
text — a product name, a product description, SEO copy, a category name — is
outlined on hover and edited in place. The change is saved when they commit it
and is live immediately, exactly as if they had used the admin form, because it
is the same field going through the same endpoint.

Content Slots are the new thing. A Slot is a named region the storefront renders
at a stable key — `homepage.hero`, `plp.banner` — holding typed content. The
storefront declares which Slots it has; the merchant fills them in, in place, on
the page where they appear. A Slot edit saves as a **draft**, visible to the
merchant in the editing frame and to nobody else, until they publish it.

The editing chrome is entirely the admin's. The storefront ships a small script
that marks editable regions and speaks a documented message protocol — the same
drop-in shape as the analytics tracker, one script tag and some data attributes
— so any storefront becomes visually editable without implementing an editor.

A Content Slot is not a page and is not composed of arbitrary nested blocks.
Inline Editing targets an existing entity field or a Slot, never free-form
layout. This is deliberately not a page builder.

## User Stories

### Editing text in place

1. As a merchant, I want to edit my product's description on the page it appears on, so that I can see it wrap under the gallery instead of guessing.
2. As a merchant, I want editable text outlined when I hover it, so that I can tell what I am allowed to change without clicking everything.
3. As a merchant, I want to click a piece of text and start typing, so that editing my Store is not a trip to a form in another section.
4. As a merchant, I want my change to appear on the page as I type, so that I am judging the real thing rather than a preview approximation.
5. As a merchant, I want to commit an edit deliberately, so that a stray click does not save something I was only trying out.
6. As a merchant, I want to abandon an edit and get the original back, so that trying a headline costs me nothing.
7. As a merchant, I want to be told when a save fails, so that I do not walk away believing copy is live when it is not.
8. As a merchant, I want a failed save to leave the text on screen so I can retry, so that I do not lose a paragraph I just wrote.
9. As a merchant, I want to edit a product name, description, and SEO copy, so that the fields that carry my words are all reachable from the page.
10. As a merchant, I want to edit a category name and description, so that listing pages are editable too and not just products.
11. As a merchant, I want to navigate the Store normally while editing, so that I can walk to the page I want to change rather than choosing it from a list.
12. As a merchant, I want editing to survive navigating between pages, so that moving from a product to its category does not drop me out of edit mode.
13. As a merchant, I want to see which page I am on and be able to open it in a real tab, so that I can check my work outside the editor.
14. As a merchant, I want a way to leave editing and return to the normal admin, so that the editor is a mode I enter and exit rather than a place I get stuck.

### Content Slots

15. As a merchant, I want to edit the headline above the fold on my homepage, so that seasonal copy does not require a developer and a deploy.
16. As a merchant, I want to edit supporting copy and the call-to-action alongside that headline, so that the hero is one coherent thing I control.
17. As a merchant, I want to add a banner to my listing pages, so that I can run a promotion without touching code.
18. As a merchant, I want a Slot I have not filled in to render nothing rather than placeholder text, so that an unconfigured Store does not show scaffolding to shoppers.
19. As a merchant, I want an empty Slot still to be visible and editable in the editor, so that I can find and fill a region that currently renders nothing.
20. As a merchant, I want my Slot edits saved as drafts, so that I can work on next week's promotion without it appearing on my live Store today.
21. As a merchant, I want to see my drafts in the editing frame, so that I am editing what I will publish rather than what is currently live.
22. As a merchant, I want to publish a Slot deliberately, so that going live is a decision and not a side effect of typing.
23. As a merchant, I want to see clearly which Slots have unpublished drafts, so that I do not forget I left something half-written.
24. As a merchant, I want to discard a draft and go back to what is published, so that abandoning an idea is one action.
25. As a merchant, I want a published Slot to keep rendering while I draft its replacement, so that editing never blanks a live region.
26. As a shopper, I want never to see a draft, so that the Store I am reading is the one the merchant intended to show me.
27. As a merchant, I want to know when a Slot was last published, so that I can tell fresh copy from copy I forgot about.
28. As a merchant, I want editing a Slot to feel the same as editing a product field, so that I do not have to learn two editors.
29. As a merchant, I want to be told plainly which of my edits are live and which are drafted, so that the difference between the two is never a surprise.

### Forking and integrating

30. As a developer forking the Starter Storefront, I want Inline Editing to work out of the box, so that I inherit a CMS without implementing one.
31. As a developer building my own storefront, I want to add a script tag and some data attributes and become editable, so that adopting this costs me an afternoon rather than a project.
32. As a developer, I want the protocol documented as a contract, so that I can implement against something stable rather than reverse-engineering the Starter Storefront.
33. As a developer, I want the protocol versioned, so that a change to it is something I can detect rather than a silent breakage.
34. As a developer, I want to declare which Slots my storefront renders, so that the merchant is offered the regions that exist rather than a free-form list.
35. As a developer, I want the edit script to do nothing at all outside an editing session, so that shipping it costs my shoppers nothing.
36. As a developer, I want the script to be absent from the page entirely in a normal visit, so that editing capability is not something a shopper's browser downloads.
37. As a developer, I want the Starter Storefront to demonstrate every part of the protocol, so that I have a worked reference rather than only prose.

### Safety and correctness

38. As a merchant, I want only my own Store's content reachable from my editing session, so that the editor can never write to another tenant's Store.
39. As a merchant, I want inline editing to respect the same permissions as the admin forms, so that entering through the editor is not a way around who is allowed to change what.
40. As a merchant, I want a support agent unable to edit my copy, so that a role with no product permissions does not acquire them by opening the editor.
41. As a merchant, I want the editor to refuse messages from any page that is not my Store, so that an editing session cannot be driven by something else.
42. As a developer, I want my storefront to refuse editing messages from anything but the admin, so that a hostile page cannot open an editing channel into it.
43. As a merchant, I want an edit recorded against my Store and entity by identity rather than by position on the page, so that a change lands on the thing I clicked and not on whatever was in that slot when the message arrived.
44. As a merchant, I want an oversized paste rejected with a clear message, so that a copied document does not silently truncate or break a page.
45. As a merchant, I want my copy stored as text, so that pasting from a word processor cannot inject markup into my Store.
46. As a merchant, I want Slot content validated against its declared type, so that a Slot expecting a headline cannot end up holding something the storefront cannot render.
47. As a merchant, I want an edit that fails to save to leave the stored value untouched, so that a broken save never destroys the copy I already had.

## Implementation Decisions

### Scope boundary

This stage delivers Inline Editing of existing text fields, Content Slots with a
draft-and-publish cycle, and the protocol that connects the admin to a
storefront. It is not a page builder, and no decision here should make one
easier to add later by accident.

### Modules

- A new backend **content** module owns Content Slots: the table, the admin CRUD
  and publish endpoints, and the public storefront read. A standalone feature
  module in the same shape as marketing and analytics.
- The **product** module is read from and written to through its **existing**
  admin endpoints. Inline editing of a product or category field calls the same
  endpoint the admin form calls. There is no second write path for the same
  field, because a second write path is a second place for validation and
  permissions to drift.
- A new **`packages/inline-edit-js`** workspace package holds the storefront-side
  edit script, built to a minified IIFE and served by the backend at a root path,
  mirroring `@repo/analytics-js` and `ca.js` exactly. That precedent is followed
  deliberately: it is how a third-party storefront adopts a browser-side contract
  here, it is already proven, and it means an integrator writes data attributes
  rather than a message handler.
- The **admin frontend** gains an editor surface: the frame, the overlay, the
  editing chrome, and all draft state, per ADR-0003.
- The **Starter Storefront** declares its Slots, renders them, marks its editable
  fields, and embeds the script when a session calls for it — the reference
  implementation, proving the contract before an integrator meets it.

### Schema

One new table, `content_slots`, tenant-scoped with `organization_id` as its
second column per the project-wide rule and also scoped by `store_id`. Columns:
the Slot `key` (the stable address the storefront renders at, unique per Store),
a `type` naming the shape of its content, the published `value`, the
`draft_value`, a `status`, the time it was last published, and timestamps.

**Deliberately no version history.** A Slot holds what is published and what is
being drafted, and nothing else. History is a feature with its own UI, its own
retention question, and its own restore semantics; adding a table now that
nobody reads would be building the storage for a feature that has not been
designed. This is a decision to revisit, not an oversight.

`products` and `categories` gain **no new columns.** An inline edit to an entity
field is the same write the admin form performs, and giving those tables draft
columns would put a second source of truth beside every form in the admin.

Slot content is stored as **text**, never as markup. What a merchant pastes from
a word processor is reduced to its text before it is stored, so a Store cannot
acquire injected markup through its own CMS. A rich-text Slot type is a later
decision that would have to answer sanitization on its own terms.

### The draft model, and its deliberate asymmetry

**An entity field edit is live on commit.** It goes through the existing admin
endpoint and behaves exactly as the admin form behaves today.

**A Slot edit saves to its draft and is published separately.** The published
value keeps rendering to shoppers until the merchant publishes, so editing never
blanks a live region.

These two behaviours differ, and the UI must make the difference unmistakable
rather than hide it — an editor where some changes are live and some are not,
and which does not say which is which, is worse than one with a single
behaviour. The asymmetry is accepted because the alternatives are worse: giving
products draft columns duplicates state beside every admin form, and holding
entity edits unsaved in the admin until a global publish means a refresh silently
discards them while Slot drafts survive, which is consistency in appearance only.

### The protocol (ADR-0003)

The admin renders the storefront in a frame. The storefront marks editable
regions with data attributes and posts messages to the parent. The admin renders
every piece of editing chrome and owns draft state, pushing values into the
frame for live preview. The storefront renders no editing UI of its own.

Because this is a public surface that is expensive to change once integrators
depend on it, it is specified deliberately:

- Every message carries an explicit **protocol version**. A version the receiver
  does not recognise is refused, loudly in the admin and silently in the
  storefront.
- **Both sides verify origin.** The storefront accepts messages only from the
  configured admin origin; the admin accepts messages only from the frame it
  opened. Neither side infers trust from message shape.
- An **editable region is identified by what it is**, not where it is: a target
  names the entity kind, its id, and the field — or, for a Slot, the Slot key. A
  message that arrives after the page has re-rendered lands on the right thing or
  on nothing.
- The message set is small and closed: the frame announces the editable regions
  on the current page and announces navigation; the admin pushes a value for
  live preview and asks the frame to focus a region. Anything outside that set is
  ignored.
- **Nothing in the protocol writes.** Saving happens in the admin, through the
  authenticated admin API, on the admin's own origin. The frame never holds a
  credential and never calls the commerce API to persist anything. This is what
  keeps an editing channel from being a privilege escalation.

The script is inert unless a session is established. Outside an editing session
it registers nothing, observes nothing, and posts nothing.

### Slot declaration

The storefront declares the Slots it renders — key, type, and a human label —
and announces them to the admin when a page loads. The merchant is offered the
regions that exist on the page in front of them rather than an open-ended list of
keys, which is what keeps Slots a set of named regions rather than a
page-building primitive.

A Slot with no published value renders nothing on the live Store and is still
announced to the editor, so a merchant can find and fill a region that currently
shows nothing at all.

### API contracts

Public storefront GraphQL gains a read for a Store's Content Slots, guarded by
the existing storefront API-key auth. It returns **published values only**. A
draft is never reachable through the public API under any argument, because the
public API is the surface a shopper's browser can reach and there is no such
thing as a draft that is safe to expose there.

New admin REST endpoints under the existing admin surface: list Slots for a
Store, save a draft, publish, and discard a draft. Guarded by new `content.read`
and `content.write` permissions, following the shape the discounts and campaigns
permissions already use — available to super admins and product managers, and
not to support agents.

Inline edits to product and category fields use the existing admin product and
category endpoints and their existing `products.update` permission. Entering
through the editor grants nothing; a role that cannot edit a product in a form
cannot edit one on the page.

The admin resolves the frame's URL from the backend, which already holds
`STOREFRONT_URL` for the tagged-link generator. One configured storefront
address, not two.

### Sequencing within the stage

Existing entity fields first, Content Slots second. This is the roadmap's
sequencing and it is load-bearing: entity fields exercise the whole protocol —
frame, overlay, targeting, save, permissions — against endpoints that already
exist, so the protocol is proven before any new storage is introduced. Slots then
add storage and a publish cycle to a channel already known to work.

### Multi-tenancy

Content Slots go through the existing tenant-scoped repository base with
row-level security as the second line of defence. Every Slot read and write is
scoped by Organization and Store before a key is matched. The editing session
carries the admin's tenant context; a target naming an entity outside it is
refused by the same guards that already protect the admin endpoints.

## Testing Decisions

A good test here asserts what a merchant or a shopper would observe — copy that
is live, copy that is not, and copy that is stored — and never asserts on how a
message was dispatched or which handler ran. The failure that matters most is
silent and one-directional: a draft that reaches a shopper cannot be recalled,
and nothing in the running system would report it.

Two seams, agreed with the developer.

**Seam 1 — the existing backend end-to-end suite, real services against local
Postgres.** The highest available seam and the one that covers the leak. Cases:
a Slot with a draft and no published value is absent from the public storefront
read; a Slot with both returns the published value and never the draft; no
argument to the public read exposes a draft; publishing makes the drafted value
public and discarding a draft leaves the published value untouched; a Slot in one
Store is invisible to another Store's API key; a Slot key is unique per Store and
the same key in two Stores is two different Slots; saving a draft and publishing
require `content.write` and a support agent is refused both; an inline edit to a
product field lands through the existing admin endpoint and is subject to
`products.update`; and content is stored as text with markup neutralised.

**Seam 2 — the protocol's pure functions, as units in the new package.** Inputs
are an untrusted message event or a data attribute string; outputs are a
validated command or a refusal. No DOM, no iframe, no network. Cases: a message
from an unexpected origin is refused; an unknown protocol version is refused; a
malformed or partial payload is refused; a valid message parses to the expected
command; a target descriptor parses to its entity kind, id, and field; a Slot
target parses to its key; a malformed descriptor is refused rather than guessed
at; and an oversized payload is refused.

This seam exists because origin and payload validation is the security boundary
of an editing channel into a live storefront, it is pure, and every one of its
failure modes is a refusal that would otherwise have to be provoked through a
real cross-origin frame to observe.

Deliberately not used: component tests, browser automation, and any test that
drives a real iframe. The overlay, the hover outline, and the editing chrome are
UI and stay untested, per the standing position that the testing floor rises only
where blast radius is money, tenancy, or — as here — a public write surface.

Prior art: the marketing and storefront e2e specs establish Seam 1's shape,
including the seeded Organization that every tenant-scoped table cascades from
and the public-versus-admin split those suites already exercise. The storefront's
Vitest specs from Stage 3 establish Seam 2's shape — pure functions, asserted on
returned values. `packages/analytics-js` is the model for the package itself; it
currently has no test runner, and this package adds one rather than following
that part of the precedent.

## Out of Scope

- **Page building.** No layout editing, no arbitrary nested blocks, no
  drag-and-drop, no creating regions from the editor. A Content Slot is a named
  region a storefront chose to render, and the vocabulary rules that out.
- **Creating pages.** No new routes, no page records, no navigation editing. The
  Store's pages are the storefront's.
- **Version history for Slots.** A Slot holds a published value and a draft.
  Restore, diffing, and retention are a designed feature, not a column.
- **Rich text and markup.** Slot content is text. A rich-text type would have to
  answer sanitization, and a storefront's ability to render it, on its own terms.
- **Media and image editing.** Swapping a product image or a hero image inline
  needs an upload path inside the frame and is a second protocol shape. Text
  first.
- **Editing prices inline.** Price is money, lives on variants rather than the
  product, and belongs to a different risk class than copy.
- **Scheduled publishing.** No publish-at-a-time. Publish is a button.
- **Localisation.** One value per Slot per Store. Translations are a dimension
  this schema does not have and should not acquire by accident.
- **Draft preview links.** No shareable URL that renders drafts. Drafts are
  visible in the editing frame and nowhere else, which is the whole reason the
  public read cannot expose them.
- **Real-time collaboration.** No presence, no locking, no conflict resolution.
  Last commit wins, which is what the admin forms already do.
- **Editing the admin's own chrome, or storefront config.** Store name, currency,
  navigation, and theme tokens stay where they are.
- **Anything in Stages 1 through 3.** Attribution, campaign performance, and the
  storefront's cart behaviour are untouched.

## Further Notes

**The draft leak is the one failure worth engineering against.** Every other
mistake in this feature is visible and reversible: wrong copy gets fixed, a
broken save gets retried. A draft that reaches the public read is a merchant's
unfinished words on their live Store, discovered by a customer rather than by
them, and no amount of fixing afterwards un-shows it. That is why the public read
returns published values only with no argument that changes it, and why the
end-to-end seam tests it from the outside rather than trusting a filter.

**Nothing in the protocol writes, and that is the security design.** The frame is
a rendering surface and an event source. Saving happens in the admin, on the
admin's origin, through the authenticated admin API, under the same permissions
as the forms. Any future proposal to let the storefront persist an edit directly
should be read as a proposal to give a cross-origin frame write access to a
tenant's catalog.

**The asymmetry between live fields and drafted Slots will generate a support
question.** It is the right trade — the alternatives duplicate state or lose it
on refresh — but merchants will ask why the headline needs publishing and the
product name does not. The answer belongs in the UI, stated where they are
working, not in documentation they will not read.

**Following the `ca.js` precedent is doing more work than it looks.** It makes
the protocol adoptable by someone who has never seen this repository, which is
the difference between a CMS for the Starter Storefront and a CMS for the
engine. ADR-0003 accepted an expensive-to-change public surface specifically to
buy that, and shipping the client side as a package is what actually delivers it.

**Entity fields first is not merely easier, it is the risk order.** They exercise
the entire protocol against endpoints, permissions, and validation that already
exist and are already tested. If the frame, the targeting, or the origin checks
are wrong, that is discovered before any new table exists to be wrong as well.

**This closes the roadmap.** After this the engine can measure what an ad
produced, judge whether it was worth it, and change what the ad points at —
which was the whole argument for sequencing attribution ahead of the CMS in the
first place.
