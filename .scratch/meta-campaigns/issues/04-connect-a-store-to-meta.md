# 04: Connect a Store to Meta

**What to build:** A merchant connects their Store to Meta once, on Meta's own
approval screen, and from then on this system can read their ad account and act
on it. Until they do, the Campaigns page is a single empty state with one button.

They approve with their own credentials, choose which ad account this Store uses
if their login can see several, and land back in the admin. An ad account billed
in a currency other than the Store's is offered but refused, with the reason
shown — every figure in this feature is in the Store's own currency and nothing
is ever converted.

Nothing is read or written on the platform yet beyond establishing the
connection; the sync is ticket 07.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The provider interface gains what this feature needs and the Zernio
      adapter is the only file naming the vendor
- [ ] Each Store gets its own vendor profile and its own scoped credential,
      never a shared one, because the vendor's write endpoints otherwise accept
      any account the team owns
- [ ] The credential is stored as a secret: never returned by a read, never
      logged, and revoked on disconnect
- [ ] A merchant starts the flow from the admin, approves on Meta's screen,
      selects a Facebook Page where Meta asks for one, and returns to the admin
- [ ] Where several ad accounts are visible, the merchant picks one; accounts in
      another currency are shown, disabled, with the reason
- [ ] Connecting an ad account whose currency differs from the Store's is
      refused server-side too, not only in the picker
- [ ] The connection records the account, its name, its currency and when access
      was granted
- [ ] The account's pixel is found, or one is created and named after the Store,
      and its id is stored on the connection
- [ ] A connection belongs to one Store: two Stores in one Organization connect
      separately, and no other Organization can read or reach either
- [ ] The Campaigns page shows a single "Connect Meta" empty state before
      connection, and a connection summary in the header afterwards
- [ ] A merchant disconnects, keeping everything already stored, and the summary
      says the connection is gone
- [ ] Connecting and disconnecting require `super_admin`; reading the connection
      requires `campaigns.read`
- [ ] An end-to-end spec drives connect, currency refusal, disconnect and
      cross-tenant isolation through the admin API against the fake provider
