# 03: Navigate the Store and leave the editor

**What to build:** A merchant editing their Store walks around it. They click
from a product to its category, follow a link to the homepage, and keep editing
the whole way — the editor follows them rather than dropping them out.

Without this the editor can only change the page it opened on, which is not how
anyone edits a store. The merchant thinks in pages they can see, not in a list of
entities to pick from, and the whole argument for editing in place is that they
navigate to the thing they want to change.

Editing is a mode, so it needs a way out as well as a way in. It also needs to be
honest about where it is: the merchant should be able to see which page they are
looking at and open that page in a real tab, because checking your work outside
the editor is a normal thing to want.

This adds one message to the protocol — the frame announcing that it has
navigated, and re-announcing the editable regions of the page it landed on.

**Blocked by:** 01 (Edit a product name in place).

**Status:** ready-for-agent

- [ ] Following a link inside the frame navigates the Store without leaving edit mode
- [ ] The editable regions of the newly-loaded page are announced and become editable, with no reload of the admin
- [ ] The merchant can see which page of their Store the frame is currently showing
- [ ] The merchant can open the current page in a real tab, outside the editor
- [ ] There is a clear way to leave editing and return to the normal admin
- [ ] An edit committed before navigating is saved, not silently discarded by the navigation
- [ ] The navigation message is versioned and origin-checked like every other message in the protocol
- [ ] A navigation to something outside the merchant's own Store does not leave the editor believing it is still editing that Store
