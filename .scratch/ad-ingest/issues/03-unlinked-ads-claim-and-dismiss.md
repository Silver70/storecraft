# 03: Unlinked Ads: claim and dismiss

**What to build:** The sync finds ads the merchant is spending real money on that
nothing in the Store claims. Each is held as an **Unlinked Ad** — never turned
into an Ad on its own — and presented as a short list with its creative, its name
and what it has spent, so the merchant can decide what it is.

Claiming resolves it: onto a Campaign as a new Ad, or onto an Ad that already
exists here. Its Reported Figures, including everything backfilled, come with it.
And because the merchant's very next problem is that the platform's link is not
tagged, the Ad's Tagged Link is offered at the moment of claiming.

This is where the product actually lives. The list is not a tidy-up queue — it is
the prompt that turns platform spend into something measurable.

**Blocked by:** 02 (Sync Reported Figures).

**Status:** ready-for-agent

- [ ] A platform ad with no link to an Ad in this Store appears as an Unlinked
      Ad, carrying its platform id, name, creative, flight dates and spend to date
- [ ] **No Ad is ever created automatically from a sync.** An Ad invented this way
      carries real cost and has no Ad Tag rule, so it would show spend against
      zero revenue and read as a catastrophic loser — auto-generating the most
      alarming card in the UI
- [ ] **Claim and dismiss go through one state transition engine.** An Unlinked
      Ad has an explicit state, transitions are declared in one place, and an
      invalid transition throws rather than silently doing nothing — the
      convention the Order state machine already sets in this codebase. No second
      path may mutate that state
- [ ] The valid transitions are stated exhaustively, including whether a
      dismissed ad can be reclaimed and whether a claimed ad can be unlinked, and
      what happens to its Reported Figures in each case. A misclick must not be
      permanent
- [ ] Claiming onto a Campaign creates an Ad under it, with the Ad Tag derivation
      and per-Campaign uniqueness ticket 01 of Stage 5 established
- [ ] Claiming onto an existing Ad records the platform's id against it without
      creating a duplicate
- [ ] A claimed ad's Reported Figures attach to the Ad it was claimed onto,
      including backfilled history — claiming does not start its spend from zero
- [ ] **The Ad's Tagged Link is offered at the moment of claiming**, carrying both
      the Campaign Tag and the Ad Tag, because pasting it into the platform is the
      merchant's next action and the only thing that makes the ad measurable
- [ ] Dismissal is durable: a dismissed ad does not return on the next sync
- [ ] The number of Unlinked Ads waiting is surfaced where the merchant will see
      it without going looking
- [ ] An Unlinked Ad is scoped to its Organization and Store, and cannot be
      claimed onto a Campaign belonging to another Organization
- [ ] Covered end to end: a sync produces an Unlinked Ad, no Ad is created, a
      claim attaches its history, and a dismissed ad stays dismissed across a
      second sync
