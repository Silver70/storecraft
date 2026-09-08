# 01: Ad as a managed object

**What to build:** A merchant can subdivide a Campaign into the individual
creatives running under it. They create an Ad, give it a name, set the dates it
runs between, rename it, and archive it when it is finished. Each Ad is listed
under its Campaign in the admin, and each one is born already carrying the
canonical Ad Tag that will later let its Orders find it.

Nothing is attributed to an Ad yet and no cost can be recorded against one — this
ticket establishes the noun and the tag, and nothing more. What it proves is that
a merchant can express "these four creatives are one push" in the system at all.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A merchant creates an Ad under a Campaign with a name, and optionally a
      start and an end date; both dates are optional and either may be set alone
- [ ] The Ad is created already owning a canonical Matching Rule on its own Ad
      Tag, on the `utm_content` field, in the same way a Campaign is created
      owning a rule on its Campaign Tag
- [ ] The Ad Tag is derived from the name using the same derivation the Campaign
      Tag uses, so both sides of a later comparison normalize identically
- [ ] The Ad Tag is unique within its Campaign and **not** within the Store: two
      Campaigns may each own an Ad tagged `video-a`, and both are accepted
- [ ] The database is the authority on that uniqueness, not the read that
      preceded the insert — two admins naming an Ad the same thing at the same
      moment must not both win
- [ ] Renaming an Ad leaves its Ad Tag unchanged, because a link already running
      in an ad platform cannot be recalled
- [ ] The canonical rule is not merchant-deletable, for the same reason
- [ ] **The Campaign matcher never reads `utm_content`.** Adding the field to the
      rule-field vocabulary must not make it a field the Campaign resolution
      ranks or compares. This is the guarantee ADR-0004 exists for: a rule on
      `utm_content` must be structurally incapable of deciding which Campaign an
      Order belongs to
- [ ] Existing Campaign resolution is unchanged — the same tuples resolve to the
      same Campaigns as before this ticket, proven by the existing matcher specs
      continuing to pass untouched
- [ ] An Ad can be archived, and an archived Ad is kept out of the active list
      without losing the history that will later explain Orders
- [ ] Archiving a Campaign archives its Ads
- [ ] Restoring a Campaign does **not** restore its Ads — the merchant
      re-activates them deliberately
- [ ] There is no way to delete an Ad, for the reason ADR-0002 gives for
      Campaigns: revenue already reported against it would be silently re-bucketed
- [ ] An Ad is scoped to its Organization and Store like every other
      tenant-scoped record, and an Ad id belonging to another Organization does
      not resolve
- [ ] A merchant sees a Campaign's Ads listed on the Campaign detail page, with
      an unremarkable state for a Campaign that has none — an Ad is a
      subdivision a merchant opts into, and a Campaign without one is not
      incomplete
- [ ] Ad management is covered end to end over real HTTP with a real admin token
      and store header, alongside the existing Campaign coverage
