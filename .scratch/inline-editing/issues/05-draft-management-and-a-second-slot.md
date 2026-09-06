# 05: Draft management and a second Slot

**What to build:** Content Slots become something a merchant can actually run a
store with, rather than one editable headline.

A second Slot on the listing pages — a promotion banner — proves the Slot
mechanism is general rather than a hero with extra steps, and it is the region a
merchant reaches for weekly.

The draft cycle gets its missing half. Today a draft can be written and
published; a merchant also needs to abandon one, to see at a glance which Slots
have unpublished work waiting, and to tell fresh copy from copy they forgot
about six weeks ago. Without that, drafts accumulate silently and the merchant
loses track of what their Store is about to say.

An unfilled Slot renders nothing to a shopper but still has to be findable and
fillable in the editor — otherwise the only way to fill a region that currently
shows nothing is to already know it exists.

**Blocked by:** 04 (The homepage hero as a Content Slot).

**Status:** ready-for-agent

- [ ] The Starter Storefront declares and renders a listing-page banner Slot, and announces it to the editor
- [ ] A Slot with no published value is announced and editable in the editor while rendering nothing on the live Store
- [ ] An empty Slot is visible enough in the editor to be found and filled, without becoming visible to shoppers
- [ ] A draft can be discarded, leaving the published value untouched
- [ ] The editor shows which Slots have unpublished drafts
- [ ] The editor shows when each Slot was last published
- [ ] Slot content is validated against the Slot's declared type, so a Slot cannot end up holding something the storefront cannot render
- [ ] Publishing and discarding require `content.write`
- [ ] End-to-end coverage: discarding a draft leaves the published value unchanged and still public, and a type-mismatched value is refused
