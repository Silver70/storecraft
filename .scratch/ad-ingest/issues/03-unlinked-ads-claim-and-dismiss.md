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

**Status:** resolved

- [x] A platform ad with no link to an Ad in this Store appears as an Unlinked
      Ad, carrying its platform id, name, creative, flight dates and spend to date
- [x] **No Ad is ever created automatically from a sync.** An Ad invented this way
      carries real cost and has no Ad Tag rule, so it would show spend against
      zero revenue and read as a catastrophic loser — auto-generating the most
      alarming card in the UI
- [x] **Claim and dismiss go through one state transition engine.** An Unlinked
      Ad has an explicit state, transitions are declared in one place, and an
      invalid transition throws rather than silently doing nothing — the
      convention the Order state machine already sets in this codebase. No second
      path may mutate that state
- [x] The valid transitions are stated exhaustively, including whether a
      dismissed ad can be reclaimed and whether a claimed ad can be unlinked, and
      what happens to its Reported Figures in each case. A misclick must not be
      permanent
- [x] Claiming onto a Campaign creates an Ad under it, with the Ad Tag derivation
      and per-Campaign uniqueness ticket 01 of Stage 5 established
- [x] Claiming onto an existing Ad records the platform's id against it without
      creating a duplicate
- [x] A claimed ad's Reported Figures attach to the Ad it was claimed onto,
      including backfilled history — claiming does not start its spend from zero
- [x] **The Ad's Tagged Link is offered at the moment of claiming**, carrying both
      the Campaign Tag and the Ad Tag, because pasting it into the platform is the
      merchant's next action and the only thing that makes the ad measurable
- [x] Dismissal is durable: a dismissed ad does not return on the next sync
- [x] The number of Unlinked Ads waiting is surfaced where the merchant will see
      it without going looking
- [x] An Unlinked Ad is scoped to its Organization and Store, and cannot be
      claimed onto a Campaign belonging to another Organization
- [x] Covered end to end: a sync produces an Unlinked Ad, no Ad is created, a
      claim attaches its history, and a dismissed ad stays dismissed across a
      second sync

## Comments

Implemented.

**The table.** `unlinked_ads` (migration `0019_unlinked_ads`) holds one row per
platform ad per connection, carrying the platform's id, name, creative and
flight dates and nothing financial at all. Spend to date is summed from
`ad_reported_figures` on the platform's ad id at read time, because those rows
are already the platform's book and a copy here would be the copy a restated day
silently leaves wrong. The unique constraint on `(connection_id,
external_ad_id)` is what makes a dismissal durable: a sync meets the same ad on
every run by design, and the conflict clause updates what the ad _looks like_
while listing neither `state` nor `claimed_ad_id`.

**No Ad is created by a sync.** `AdPlatformSyncService` writes figures, then
calls `UnlinkedAdService.recordSighting`, which holds rows. There is no code
path from a sync to `AdService.create`, and the e2e spec asserts the `ads` table
is still empty after two runs over an ad nobody claims.

**One transition engine.** `utils/unlinked-ad-state.util.ts` declares every
move in a single table and is the only place that answers whether one exists;
`UnlinkedAdRepository.transition` is the only method in the codebase that writes
`unlinked_ads.state`, and it carries `state = from` in its own predicate, so two
admins clicking Claim and Dismiss at the same moment do not resolve by whichever
read happened first — one matches no row and is refused. The sync's own
reconciliation goes through the same table. An illegal move throws a 409 with a
sentence, as `OrderService.transition` does.

The transitions, exhaustively: `pending → claimed` (claim), `pending →
dismissed` (dismiss), `dismissed → pending` (restore), `dismissed → claimed`
(claim, without restoring first — a click that decides nothing is not worth
asking for), `claimed → pending` (unlink). `claimed → dismissed` is deliberately
absent: it would detach an Ad and record a refusal in one move without showing
the merchant which they had just done. Every other pair is refused. 26 unit
cases assert all twelve pairs, and that the two blocks between them cover every
one.

**Reported Figures in each case: nothing happens to them, ever.** No transition
moves, rewrites or deletes a figure. What a claim writes is `ads.external_id` —
the join `ad_reported_figures` was keyed for in ticket 02 — so every day already
pulled, backfill included, attaches the moment it is set. Unlink clears that
column, detaching the history without losing a row; a reclaim brings all of it
back, which the spec asserts by claiming, unlinking and reclaiming the same
three days. A dismissed ad's spend stays pulled and stays readable on
`GET /ad-platforms/reported-figures`: the merchant declined to attribute the
money, not to know about it.

**Claiming onto a Campaign** goes through `AdService.create`, not an insert of
its own, so the Ad Tag derivation, the per-Campaign uniqueness and the canonical
`utm_content` rule from Stage 5's ticket 01 are the same ones a hand-created Ad
gets — asserted by reading the rule row back. The platform's creative is carried
onto the Ad's `creative_url`, which is exactly the column's stated purpose.

**Claiming onto an existing Ad** records the platform's id and creates nothing.
A new partial unique index, `ads_store_external_id_unique` on `(store_id,
external_id) where external_id is not null`, is the authority rather than the
read above it: two Ads carrying one platform id would both match the same
figures and report the same spend twice under two names.

**The Tagged Link is on the claim response.** `ClaimResult` carries the
`CampaignTaggedLink` composed from the Campaign's tag and the new Ad's tag, with
source and medium defaulted from the Campaign's platform
(`PLATFORM_LINK_DEFAULTS`, now in `tagged-link.util.ts` where link composition
lives). A problem composing one is _reported_, never thrown — the ad is claimed
either way, because failing a claim that already succeeded over a convenience
would be the worst of both. The UI puts the link and a copy button on the card
the moment the claim lands, rather than replacing the row with a tick.

**Where the count is.** `GET /ad-platforms/unlinked-ads/count` is its own cheap
read, and the campaigns page shows it as a badge above the card grid — not
suspended on, so a store with no connected platform and a failed read both leave
the grid whole. The settings panel that ran the sync also says how many came
back unclaimed, because a merchant who has just connected a platform is exactly
the merchant with a list full of them.

**Scoping.** Every repository method takes the Organization and the Store and
filters on both. A claim naming another Organization's Campaign is refused
_before_ anything is created — the transition is checked first and applied last,
so a refusal leaves no Ad behind.

Endpoints: `GET /api/admin/ad-platforms/unlinked-ads` and `.../count` under
`ad_platforms.read`; `POST .../:id/claim`, `/dismiss`, `/restore` and `/unlink`
under `campaigns.write`, because a claim creates an Ad under a Campaign and that
is the same authority as creating it by hand — no new permission was invented
for a second route to one change.

Covered by `test/unlinked-ads.e2e-spec.ts` (27 cases) against a real Postgres
database with only the provider faked, plus 37 pure unit cases across the
transition table and the sync's hold/resolve/release plan. Asserted end to end:
a sync produces an Unlinked Ad carrying its creative, flight and $300 of spend;
no Ad is created on the first sync or the second; a claim attaches three days of
history and answers with a link carrying both tags; a claim onto an existing Ad
creates no duplicate; a dismissed ad is still absent after a second sync that
re-reports it, while its figures stay readable; a claimed ad refuses dismissal
and says to unlink first; unlinking keeps the Ad, clears the id and deletes no
figure; and neither another Organization nor another Store of the same one can
see, claim or dismiss any of it.

**One thing ticket 02 said is now narrower.** Its comments record that
`campaign_spend` was "not reachable from this module at all". `AdPlatformModule`
now imports `MarketingModule` — for `AdService`, so a claim derives an Ad Tag
the one way this codebase derives one — and `MarketingModule` exports the spend
providers, so that reachability claim no longer holds structurally. What holds
is narrower and is written on the module: nothing here injects
`CampaignSpendRepository` or `CampaignSpendService`, and `AdPlatformSyncService`'s
constructor is the check to make on any change. The alternative was a second
implementation of tag derivation inside this module, and the thing it would have
drifted from is the only reason a claimed ad can ever earn revenue.

Ticket 04 inherits the claim: an Unlinked Ad resolved onto an Ad is what gives a
synced figure an Ad to have provenance _against_.
