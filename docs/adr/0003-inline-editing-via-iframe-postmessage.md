---
status: accepted
---

# Inline Editing uses an iframe + postMessage protocol owned by the admin

The admin renders the storefront in an iframe. The storefront ships a small
edit-mode script that marks editable regions with data attributes and posts
messages to the parent; the admin renders all editing chrome and owns draft
state, pushing drafts into the frame for live preview. The alternative — an SDK
where the storefront renders its own editing UI and the admin merely links to it
— was rejected.

## Consequences

The editing experience is ours, so it improves for every integrator without them
shipping code, and a storefront only has to implement a documented protocol
(data attributes plus a message contract) to become visually editable. The cost
is that this protocol is a public surface and expensive to change once
integrators depend on it, so it is specified and versioned deliberately rather
than evolved ad hoc. `apps/storefront` is the reference implementation and
proves the protocol before third parties meet it.
