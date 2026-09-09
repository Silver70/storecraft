# 02: Spend against an Ad

**What to build:** A merchant records what one creative cost, rather than only
what the whole push cost. Spend can now name an Ad, or name no Ad and belong to
the Campaign as a whole, and a Campaign's Spend for a period is the sum of both.

This ticket lands before per-Ad revenue deliberately. It carries the single most
dangerous change in the stage, and it is safer to land it while nothing depends
on it yet.

**Blocked by:** 01 (Ad as a managed object).

**Status:** resolved

- [x] Spend gains an optional Ad. A row naming no Ad means the cost is known and
      its split is not — never that it belongs to no Ad
- [x] **The day-uniqueness guarantee survives.** Today one row per Campaign per
      day is enforced, which is what makes recording Spend an upsert and what
      makes a double-submit correct a day instead of doubling it. After this
      change there must be at most one Campaign-level row per day **and** at most
      one row per Ad per day
- [x] Beware the trap: a plain unique constraint including the Ad column does
      **not** deliver this, because Postgres treats NULLs as distinct, so two
      Campaign-level rows for one day would both be admitted. This
      reintroduces exactly the silent doubling the existing constraint prevents —
      a halved ROAS, forever, with nothing thrown. Use `NULLS NOT DISTINCT` or a
      pair of partial unique indexes
- [x] A double-submit of a Campaign-level figure for one day corrects that day
      rather than doubling it, proven by test
- [x] A double-submit of an Ad-level figure for one day corrects that day rather
      than doubling it, proven by test
- [x] A Campaign-level row and an Ad-level row for the same day coexist, and are
      both counted
- [x] A Campaign's Spend for a period is the sum of its own rows and its Ads'
      rows. The two levels never disagree about what a push cost
- [x] **The migration invents no Ads.** Existing Spend rows keep no Ad. A
      synthetic "default Ad" would sit in the card grid forever claiming to be a
      creative that never ran
- [x] Range entry works at the Ad level the way it already does at the Campaign
      level
- [x] A Spend row remains editable and deletable, unlike a Campaign or an Ad: it
      is a record of what a merchant typed, and a wrong one should be removable
- [x] `currency` stays denormalized on the row and there is still no conversion
      anywhere in this feature
- [x] A merchant records and corrects Ad-level Spend from the admin, and the
      figures update without a manual reload
- [x] Covered end to end alongside the existing Spend coverage, with the
      double-submit cases asserted first

## Comments

Implemented 2026-09-09.

**The constraint.** `campaign_spend` gains a nullable `ad_id`, and migration
`0014_spend_against_an_ad` drops `campaign_spend_campaign_day_unique` for
`campaign_spend_campaign_ad_day_unique UNIQUE NULLS NOT DISTINCT (campaign_id,
ad_id, day)`. `NULLS NOT DISTINCT` over a pair of partial indexes because it
keeps the upsert a single statement at both grains: `ON CONFLICT (campaign_id,
ad_id, day)` infers it, so `record` and `recordMany` are unchanged in shape and
there is no second write path for the finer grain to drift down. That inference
was probed against the local Postgres before any of this was written — with a
plain `UNIQUE`, both a null-`ad_id` insert and its double are admitted; with
`NULLS NOT DISTINCT`, the second corrects the first. Confirmed applied:
`indnullsnotdistinct = true`, old constraint gone, `ad_id` nullable.

Nothing backfills the column. Existing rows keep `ad_id = NULL`, which is what
they always were: cost known, split not.

**The grain is a value, not a flag.** Every service write takes a `SpendTarget`
(`organizationId`, `storeId`, `campaignId`, `adId`), and null `adId` is a real
answer rather than a missing one. Grouped into an object rather than trailing
three other ids, because a fourth positional uuid is a call site where a
transposition type-checks and the two it would swap are the Campaign and the
creative. `requireTarget` checks both ids together, so an Ad belonging to a
sibling Campaign is a 404 — never a row whose `ad_id` points across a boundary
its `campaign_id` denies.

**Reads span both grains, writes name one.** A Campaign's Spend for a period is
its own rows plus its Ads', totalled from the rows already loaded rather than
from a second query that could answer differently from what is on screen.
`unsplitTotal` and `byAd` divide that same figure rather than adding to it, so
the parts reconcile against the total by construction. `sumByCampaign` needed no
change — it never grouped by `ad_id` — which is what makes ROAS on the revenue
report count an Ad's spend as its Campaign's, now asserted there.

**API.** `AdminAdSpendController` at `admin/campaigns/:campaignId/ads/:adId/spend`
carries the full five verbs, deliberately reusing the Campaign-level DTOs and
service: an Ad's spend is not a different kind of fact, and a second vocabulary
would invite the two to drift on the one thing they must agree about. The Ad in
the path is a boundary — a sibling Ad's row or a Campaign-level row is a 404
through it. Edits and deletes are also reachable at the Campaign level whichever
grain the row was typed at, which is the address the admin UI uses, since the row
id already names one row and the Campaign scope is already the tenancy check.

**Frontend.** The spend card gains a "For" selector on both entry forms, present
only once the Campaign has an Ad — a Campaign a merchant has not split keeps
exactly the form it had before Ads existed. Each row is labelled with its
creative or with "Whole campaign" (blank would read as a row that failed to load
its Ad), and a footer breaks the period's total into "Not split by ad" plus a
line per Ad, using the backend's figures rather than re-summing money in the
browser. Ads are fetched with `status=all` so a retired creative's rows still say
whose they are. Range entry, correction and deletion all work at either grain,
through the same mutations and the same invalidation, so figures update without a
reload.

**Verification.** Backend `tsc --noEmit` and ESLint clean; unit suite passes at
284. Frontend `tsc --noEmit` and `vite build` clean.

The integration suite ran against local PostgreSQL 18: **231 of 232 pass**, with
`campaign-spend.e2e-spec.ts` at 65 of 65 — 22 of them new. The double-submit
cases are asserted first, before anything else in the block: an Ad-level day
recorded twice, a Campaign-level day recorded twice now that Ads exist, and both
grains refusing a duplicate written straight at the table, which is where the
`NULLS NOT DISTINCT` trap would surface. Then coexistence (a Campaign-level row
and an Ad-level row on one day, two Ads on one day, reading order), the sum
across grains with `unsplitTotal + byAd == total`, the migration inventing no
Ads, Ad-level range entry and its double-submit, edit and delete, the currency
and refusal rules at the finer grain, spend against an archived Ad, and tenancy
across Organizations and across sibling Campaigns.
`campaign-revenue.e2e-spec.ts` gains one case proving a Campaign's ROAS counts
its Ads' spend as its own.

**The one failure is pre-existing and unrelated** — the same
`inline-edit.e2e-spec.ts` assertion ticket 01 recorded, left behind by the
content-slot work in `2e9714e`. Both that controller and that spec are untouched
here; confirmed failing identically with this ticket's changes stashed.

**Not verified:** the admin UI was not exercised in a browser.
