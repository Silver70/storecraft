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

**Status:** resolved

- [x] A vendor-neutral ad-platform provider interface exists, with the vendor's
      adapter behind it, following the payment provider precedent exactly: the
      interface is the seam, and the vendor is one implementation of it
- [x] **The vendor's name appears only in the adapter.** No service, repository,
      controller, table, column or domain type is named after it. This stage's
      entire premise is that the integration is disposable, and a vendor name in
      the domain is how that quietly stops being true
- [x] **The interface has no method that creates, boosts, edits, pauses or
      budgets an ad.** Mirror-only is enforced by the absence of the capability,
      not by a rule someone has to remember
- [x] An in-memory fake implementation is swapped in for tests through the test
      app helper, exactly as the payment provider fake already is, and records
      what it was asked for
- [x] A merchant starts a connection for a Store and is sent to the platform's
      own approval and account-selection screens; we do not build a per-platform
      account picker
- [x] The merchant returns to the admin when the flow completes, and a failed or
      abandoned approval returns them somewhere sensible rather than a dead end
- [x] One vendor profile per **Store**, not per Organization — Campaigns and
      currency are both Store-scoped, and a US store and a UK store must not
      share an ad account
- [x] **A scoped credential is issued per Store** rather than one credential used
      everywhere. The vendor's own documentation warns its posting endpoint
      accepts any account id the team owns regardless of profile, which is the
      inverse of the tenant scoping this codebase holds everywhere else
- [x] Credentials are stored as secrets: never returned by any read, never
      logged, never sent to the frontend
- [x] A merchant sees which platforms a Store is connected to, and when each was
      connected
- [x] A merchant disconnects a platform, and anything already pulled survives the
      disconnect — revoking access must not rewrite past reports
- [x] A connection is scoped to its Organization and Store, and is unreachable
      from another Organization
- [x] Covered end to end over real HTTP with a real admin token and store header,
      against the fake provider

## Comments

Implemented. The seam is `AdPlatformProvider`
(`apps/backend/src/modules/ad-platform/interfaces/ad-platform-provider.interface.ts`)
bound to one adapter in `ad-platform.module.ts`, exactly as `PAYMENT_PROVIDER`
binds `StripeAdapter`. The vendor's name appears in `ayrshare.adapter.ts` and
nowhere else — a contract spec
(`ad-platform-provider.contract.spec.ts`) fails the build if a write verb ever
appears on the adapter's surface, so mirror-only is asserted rather than
remembered.

Two tables rather than one, because they have two lifetimes:
`ad_platform_connections` is what the merchant sees and what a Reported Figure
will later point at (disconnected, never deleted), and `ad_platform_credentials`
holds the per-Store secret (sealed with AES-256-GCM, destroyed when the Store's
last connection goes). The unique index on `store_id` is the per-Store rule made
structural.

The return trip from the platform lands on `GET /api/ad-platforms/callback`,
outside `/admin`, because a browser redirect from a third party carries no admin
token. It is authenticated by a signed handoff naming the Organization, Store
and platform — the same shape of decision as the Stripe webhook resolving its
tenant from a record rather than from the payload. It always ends in a redirect
into the admin, including when the merchant denied, abandoned, or the provider
was down.

Covered by `test/ad-platform-connections.e2e-spec.ts` (24 cases over real HTTP
against the fake provider), plus unit specs for the sealing and the handoff.

Two things a later stage inherits: the interface has no ad-tree read yet — issue
02 adds it alongside the sync — and `ADMIN_URL` / `API_PUBLIC_URL` /
`AD_PLATFORM_ENCRYPTION_KEY` are new environment variables (all optional, so an
unrelated deployment still boots).
