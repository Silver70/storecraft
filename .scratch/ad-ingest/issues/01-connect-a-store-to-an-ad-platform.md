# 01: Connect a Store to an ad platform

**What to build:** A merchant connects a Store to an ad platform. They start the
connection from the admin, approve it on the platform's own screen with their own
credentials, and land back in the admin with the platform listed as connected.
They can see what a Store is connected to, and disconnect without losing anything
already pulled.

Nothing is synced yet. What this ticket proves is that a real merchant can grant
access, that the credential is held safely and per Store, and that the boundary
where this codebase reaches a third party is a swappable seam rather than a
hard-wired call.

**Blocked by:** None (can start immediately). The whole of `.scratch/ad-cards/`
must be complete before this stage begins.

**Status:** ready-for-agent

- [ ] A vendor-neutral ad-platform provider interface exists, with the vendor's
      adapter behind it, following the payment provider precedent exactly: the
      interface is the seam, and the vendor is one implementation of it
- [ ] **The vendor's name appears only in the adapter.** No service, repository,
      controller, table, column or domain type is named after it. This stage's
      entire premise is that the integration is disposable, and a vendor name in
      the domain is how that quietly stops being true
- [ ] **The interface has no method that creates, boosts, edits, pauses or
      budgets an ad.** Mirror-only is enforced by the absence of the capability,
      not by a rule someone has to remember
- [ ] An in-memory fake implementation is swapped in for tests through the test
      app helper, exactly as the payment provider fake already is, and records
      what it was asked for
- [ ] A merchant starts a connection for a Store and is sent to the platform's
      own approval and account-selection screens; we do not build a per-platform
      account picker
- [ ] The merchant returns to the admin when the flow completes, and a failed or
      abandoned approval returns them somewhere sensible rather than a dead end
- [ ] One vendor profile per **Store**, not per Organization — Campaigns and
      currency are both Store-scoped, and a US store and a UK store must not
      share an ad account
- [ ] **A scoped credential is issued per Store** rather than one credential used
      everywhere. The vendor's own documentation warns its posting endpoint
      accepts any account id the team owns regardless of profile, which is the
      inverse of the tenant scoping this codebase holds everywhere else
- [ ] Credentials are stored as secrets: never returned by any read, never
      logged, never sent to the frontend
- [ ] A merchant sees which platforms a Store is connected to, and when each was
      connected
- [ ] A merchant disconnects a platform, and anything already pulled survives the
      disconnect — revoking access must not rewrite past reports
- [ ] A connection is scoped to its Organization and Store, and is unreachable
      from another Organization
- [ ] Covered end to end over real HTTP with a real admin token and store header,
      against the fake provider
