# 03: Campaign entity and admin management

**What to build:** A merchant can manage the things they spend money on. A new Marketing section in the admin sidebar lists Campaigns and lets the merchant create, edit and archive them.

A Campaign has a name, a platform, an optional ad-platform id for later reconciliation, and a status. On creation it receives a canonical tag slug derived from its name, unique within the Store, plus an implicit exact-match rule on that tag — so links generated from the Campaign always match it without the merchant authoring any rule.

Campaigns are managed objects with full CRUD, like Discounts, which is why they live in their own sidebar section rather than as another tab on the read-only Analytics page. Archiving keeps a finished Campaign out of the active list without losing its history. A Campaign can never be removed in a way that destroys the Orders it explains.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A merchant can create a Campaign with a name and platform and see it in a Marketing section of the sidebar
- [ ] Creating a Campaign assigns a canonical tag slug that is unique within the Store
- [ ] A newly created Campaign already matches its own canonical tag with no rule authored by hand
- [ ] A merchant can edit a Campaign's name, platform and ad-platform id after creation
- [ ] A merchant can archive a Campaign and it leaves the active list while remaining retrievable
- [ ] Campaigns are visible only within the Organization and Store that own them
- [ ] Campaign endpoints enforce the same admin permissions as other admin writes
