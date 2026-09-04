# 01: Record Spend against a Campaign

**What to build:** A merchant opens one of their Campaigns and records what they
spent on it on a given day. The figure appears in a list of that Campaign's
Spend rows for the selected period, and can be corrected or removed afterwards.

Recording Spend for a day that already has a figure **corrects** that day rather
than adding to it. This is the load-bearing behaviour of the ticket: insert
semantics would let a double-submit silently double a day's cost and halve the
Campaign's ROAS forever, and nothing would ever throw.

Spend is money like every other figure here — an integer in the smallest
currency unit, in the Store's currency, never a float. The day is a calendar
date interpreted in the Store's timezone, because that is the day the ad
platform is reporting. Spend may be recorded against an archived Campaign;
closing out a finished Campaign's real cost is normal.

Nothing reads Spend yet. That is ticket 03.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A `campaign_spend` table exists, tenant-scoped with `organization_id` as its second column and also scoped by `store_id`, holding a Campaign reference, a calendar `day`, an integer `amount` in minor units, a three-letter `currency`, an optional note, and timestamps
- [x] A unique constraint on `(campaign_id, day)` makes the database, not the read that preceded the write, the authority on one-row-per-day
- [x] Currency is stored on the row rather than read from the Store at report time, so a later Store currency change cannot reinterpret historical Spend
- [x] Recording Spend for a day that already has a row updates that row; the same request sent twice leaves one row with the amount from the last request
- [x] A Spend row can be updated and deleted through the admin API
- [x] A Campaign's Spend rows for a period can be listed through the admin API
- [x] Negative amounts are rejected
- [x] Dates in the future (relative to the Store's timezone) are rejected
- [x] Spend in a currency other than the Store's is rejected — there is no conversion anywhere in this feature
- [x] Spend can be recorded against an archived Campaign
- [x] Writes require `campaigns.write` and reads require `campaigns.read`, so a support agent cannot alter cost data
- [ ] Spend rows go through the tenant-scoped repository base, and row-level security covers the table as it does campaigns and matching rules — **partially**: the table matches Campaigns and matching rules exactly (org+store on every query, RLS session context), but no repository in this codebase extends `TenantScopedRepository`, so neither does this one. See Comments.
- [x] The Campaign detail page has a Spend section: the rows for the selected period, single-day entry, and inline edit and delete
- [x] Amounts are formatted only at the edge, through the existing frontend money helper
- [x] End-to-end coverage in the existing harness against local Postgres: a row is recorded and read back; re-recording the same day corrects rather than doubles; update and delete take effect; negative amount, future date, and foreign currency are all rejected; and Spend never crosses an Organization boundary

## Comments

Implemented 2026-09-04.

**The upsert is the ticket.** `campaign_spend` carries
`campaign_spend_campaign_day_unique` on `(campaign_id, day)`, and
`CampaignSpendRepository.record` is an `onConflictDoUpdate` against it rather
than a read followed by an insert. The read-then-write shape would have let two
submits of the same figure both insert; the constraint is what makes the
database, not the request that got there first, the authority on one row per
day. `setWhere` restates the tenant filter on the update branch so the write can
only ever land on a row of the caller's Organization and Store.

**Currency is frozen from the Store, not echoed from the caller.** The request
must name the Store's currency — it is refused otherwise, since there is no
conversion anywhere in this feature — but the value written to the row is
`store.currency`, in the Store's own casing. A request saying `usd` stores
`USD`. That keeps a later Store currency change from reinterpreting historical
Spend as a different unit of money.

**The day is a calendar date in the Store's timezone.** `spend-day.util.ts` is
pure and takes `now` as a parameter, so the future-date refusal is exercised
without waiting for one. It also owns the `[start, end)` → inclusive day-range
conversion the list endpoint needs, built on the existing
`resolvePeriodRange` rather than a second definition of "the last 30 days" —
ticket 03 reads Spend for a period against the same helper. An unresolvable
`stores.timezone` (it is a free-text column) falls back to UTC rather than
failing every Spend write.

**API.** A dedicated `AdminCampaignSpendController` on
`admin/campaigns/:campaignId/spend`, rather than a fourth sub-resource on
`admin/campaigns/:id` whose route ordering has to be reasoned about — the rules
routes already carry that caveat. `GET` requires `campaigns.read`, and `POST`,
`PATCH` and `DELETE` require `campaigns.write`, so a support agent can neither
read nor alter cost data. The list response also carries the Store's currency,
timezone and today's date: those are what an entry form needs to be correct, and
a date picker capped by the browser's clock would be wrong for anyone not
sitting in the Store's timezone.

**Update covers the amount and the note, not the day.** Moving a figure to
another day is recording it there — which corrects that day — and deleting the
row entered by mistake. Allowing a move would need its own answer for landing on
a day that already has a figure, and "silently replace the other one" is not
what a merchant would expect. Delete removes the row rather than zeroing it,
because a zero is itself a claim: that the Campaign ran that day and cost
nothing.

**Tenancy.** `CampaignSpendRepository` takes the Organization and Store on every
method and filters on both, in the same shape as `CampaignRepository` — a spend
id from another tenant reads as "not found". Note that `TenantScopedRepository`
is still unused by any repository in this codebase (it requires a per-request
`TenantContext`, and nothing wires one into a provider), and no table has an
explicit `ENABLE ROW LEVEL SECURITY` policy — RLS is the session context set by
`SetRlsContextInterceptor`. So `campaign_spend` matches Campaigns and matching
rules exactly, which is what that acceptance line asked for; it does not extend
the base class, because no repository does. Raising rather than doing it
silently.

**Frontend.** `CampaignSpendCard` on the Campaign detail page: period tabs
(today/7d/30d/90d), the recorded days for the period with a period total,
single-day entry, and inline edit and delete per row. Amounts are formatted only
at the edge through `formatMoney`. Entry parsing refuses anything that is not a
positive decimal instead of leaning on `toCents`, which answers 0 for a negative
— silently recording a zero where a merchant typed something else is the exact
category of quiet wrongness this feature exists to prevent. The day defaults to
today *where the Store is*, read from the API.

Verified: `npm test` 211 passed (14 suites); `npm run test:e2e` 113 passed (7
suites), including 26 new specs in `test/campaign-spend.e2e-spec.ts`; `nest
build` and backend `tsc --noEmit` clean; frontend `npm run build` (which runs
`tsc --noEmit`) clean; `prettier --check` and eslint clean on every file
touched. The Spend card was not exercised in a browser — there is no browser
available in this session — so its verification is the type-check, the build,
and the API underneath it.

**Pre-existing lint failures are untouched.** `npx eslint src test` still
reports the same `@typescript-eslint/unbound-method` errors in
`inventory.service.spec.ts` and `order.service.spec.ts`, plus one
`prettier/prettier` error in `order.repository.ts`. None are in files this
ticket touched.

**Out of scope, as specified.** Nothing reads Spend yet — no ROAS, no
Contribution Margin, no report column (tickets 03 and 04). Range entry is ticket
02; the day-range helper it will need is already here and unit-tested.
