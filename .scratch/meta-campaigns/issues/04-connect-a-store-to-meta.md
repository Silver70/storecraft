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

**Status:** resolved

- [x] The provider interface gains what this feature needs and the Zernio
      adapter is the only file naming the vendor
- [x] Each Store gets its own vendor profile and its own scoped credential,
      never a shared one, because the vendor's write endpoints otherwise accept
      any account the team owns
- [x] The credential is stored as a secret: never returned by a read, never
      logged, and revoked on disconnect
- [x] A merchant starts the flow from the admin, approves on Meta's screen,
      selects a Facebook Page where Meta asks for one, and returns to the admin
- [x] Where several ad accounts are visible, the merchant picks one; accounts in
      another currency are shown, disabled, with the reason
- [x] Connecting an ad account whose currency differs from the Store's is
      refused server-side too, not only in the picker
- [x] The connection records the account, its name, its currency and when access
      was granted
- [x] The account's pixel is found, or one is created and named after the Store,
      and its id is stored on the connection
- [x] A connection belongs to one Store: two Stores in one Organization connect
      separately, and no other Organization can read or reach either
- [x] The Campaigns page shows a single "Connect Meta" empty state before
      connection, and a connection summary in the header afterwards
- [x] A merchant disconnects, keeping everything already stored, and the summary
      says the connection is gone
- [x] Connecting and disconnecting require `super_admin`; reading the connection
      requires `campaigns.read`
- [x] An end-to-end spec drives connect, currency refusal, disconnect and
      cross-tenant isolation through the admin API against the fake provider

## Comments

Done. Backend `tsc`, `nest build`, `npm test` (208 unit specs) and the frontend
build are all green, and `eslint` is clean over everything touched.
`npm run test:e2e` has 133 passing and one failure — `inline-edit.e2e-spec.ts`,
the same assertion tickets 01, 02 and 03 each recorded, which asserts an exact
object that has since gained `canEditContent`. It does not touch ad platforms.
`npm run lint` reports only the same 7 pre-existing `unbound-method` errors in
`inventory.service.spec.ts` and `order.service.spec.ts`.

The adapter is `modules/ad-platform/services/zernio.adapter.ts` and is the only
file in the codebase naming the vendor; `unconfigured-ad-platform.adapter.ts`
is deleted, as ticket 01 said it would be.

Judgement calls not on the checklist:

**Connecting is two steps, and the middle one is a row.** Meta grants access and
asks for a Facebook Page; it cannot be asked which ad account belongs to this
Store, because it has never heard of the Store. So the return trip records a
grant (`status = 'awaiting_account'`, `provider_account_ref` set,
`external_account_id` still null) and the merchant picks in the admin. Holding
that state in the browser instead would mean a merchant who closes the tab — or
picks an account that is refused — goes back through Meta's approval screen to
try again. `connected_at` is the moment the account was chosen, not the moment
they came back.

**One usable ad account is not a choice.** Where the login can see exactly one
account this Store can use, the return trip connects it and skips the picker;
several accounts, or one that is refused, gets the picker and its reasons. If
listing the accounts fails on the way back, the grant survives and the merchant
lands on the picker rather than on a failure — re-approving at Meta is an
expensive way to retry a `GET`.

**The currency rule lives in one pure function.** `account-currency.util.ts`
produces the merchant-facing sentence, and both the picker and the selection
endpoint call it, so the two cannot disagree about what is allowed. A missing
currency is refused rather than assumed to match. The platform's own objection —
unpaid balance, closed account — wins over the currency one, because telling a
merchant about the currency first sends them to fix the wrong thing.

**The interface stopped being read-only, and the contract spec changed with it.**
The old spec asserted that no write verb appeared on the adapter's surface. That
rule was real and ADR-0006 retired it — campaigns are created here now, and this
ticket's own pixel creation is already a write. What replaced it is what the
spec asks for instead: the adapter's public surface is asserted in both
directions against the interface, so a method the adapter grows and the fake
does not is caught rather than becoming a path the e2e suite never runs.

**`completeConnection` returns a grant, not an account.** `ConnectedAccount` is
gone. `disconnect`, `fetchAdTree`, `listAdAccounts` and `ensurePixel` all take
the grant's `providerAccountRef`, because every vendor call after approval names
it. `StoreCredential` gains `providerKeyRef` and the credentials table gains
`provider_key_ref`: a secret cannot name itself for deletion, so without it
"revoked on disconnect" was true of our copy and false of theirs.

**Profile and key lifecycle go through the team key; everything else through the
Store's.** Creating and destroying a Store's profile and scoped key are the only
two calls the team key makes. A scoped key cannot reliably revoke itself, and
using the team key for ordinary calls would defeat the reason the scoped one
exists.

**Reading the connection moved to `campaigns.read` and `ad_platforms.read` is
deleted.** It had no other caller. A `product_manager` can see which account
produced the figures they can already see; connecting, picking the account and
disconnecting stay on `ad_platforms.write`, which is `super_admin` only.

**`hasOtherConnected` now counts a connection that is awaiting its account.** It
has a grant only this credential can finish, and destroying the key under it
would strand a merchant halfway through connecting a platform they never asked
to disconnect.

**The Ad Platforms settings panel is deleted, not updated.** Connection lives on
the Campaigns page now, as this ticket asks. Leaving the old panel would have
left a second Connect button that returns the merchant to a page with no picker
on it, and its copy ("Access is read-only: nothing here can create, change or
spend money on an ad") stopped being true with ADR-0006. The settings route's
`ad_platform`/`ad_platform_result` search params moved to `/admin/campaigns`
with it. Sync-now moved into the header panel as Refresh.

**Two things still to confirm against a live account**, both already flagged for
tickets 07 and 13 and neither reachable without one:

- `fetchAdTree` is implemented against `GET /v1/ads/tree` with
  `source=all&timeIncrement=1&dailyLevel=ad`, converting at the edge with
  `reported-money.util`. The ad node's platform id is read as
  `platformAdId ?? _id`; the published example shows only `_id`, which is the
  vendor's own document id, so the field carrying Meta's ad id needs confirming
  before ticket 07 keys rows on it.
- Whether the vendor's `clicks` is link clicks or Meta's "clicks (all)" is still
  undocumented, as the spec says. Nothing in this ticket reads it.

**Deployment needs `ZERNIO_API_KEY`** (and `AD_PLATFORM_ENCRYPTION_KEY`, which
was already required). Neither is in `.env`; both are documented in `CLAUDE.md`.
The key is read lazily, so a deployment without it still boots and only a
merchant pressing Connect Meta is told the integration is not configured.

`CONTEXT.md` gains **Ad Account**, and **Ad Platform Connection** gains the
sentence about approval and account selection being two durable steps.
