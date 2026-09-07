# 06: The protocol as a documented, versioned contract

**What to build:** A developer who has never seen this repository makes their own
storefront visually editable — adds a script tag, marks some regions with data
attributes, and the merchant can edit it from the admin.

ADR-0003 accepted an expensive-to-change public surface specifically to buy this.
Shipping the client side as a droppable script is half of what delivers it; a
specification an integrator can implement against, rather than reverse-engineer
from the Starter Storefront, is the other half.

This lands last on purpose. A contract documented while the protocol is still
moving documents intentions; documented after, it documents the thing. By this
point every message in the set has been exercised by real editing of real fields
and real Slots.

The Starter Storefront is the worked reference the document points at — it
already demonstrates every part of the protocol, and saying so is cheaper than
writing examples that will drift from it.

**Blocked by:** 02 (The rest of the editable text), 03 (Navigate the Store and leave the editor), 04 (The homepage hero as a Content Slot), 05 (Draft management and a second Slot).

**Status:** resolved

- [x] The data attributes an integrator writes are specified: how an editable region names its entity kind, id, and field, and how a Slot region names its key
- [x] How a storefront declares the Slots it renders — key, type, and human label — is specified
- [x] The complete message set is documented, and stated to be closed: anything outside it is ignored
- [x] Protocol versioning is documented, including what a receiver does with a version it does not recognise
- [x] The origin rules are documented for both sides, and the reason is stated: this is an editing channel into a live storefront
- [x] It is stated plainly that nothing in the protocol writes — the frame holds no credential, and saving happens in the admin under its own permissions
- [x] How to embed the script, and that it is inert outside an editing session, is documented
- [x] The document points at the Starter Storefront as the worked reference implementation rather than duplicating it in examples
- [x] The document records what is deliberately absent: no layout editing, no page creation, no version history, no rich text, no localisation
- [x] An integrator can follow it end to end without reading the Starter Storefront's source, verified by doing it
