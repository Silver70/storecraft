# 04: Spend provenance and pinning

**What to build:** A synced figure and a merchant's own entry can both describe
the same day for the same Ad. The row now records which it is. A sync wins by
default, so the merchant is not maintaining two sets of books — but a day they
corrected by hand is pinned, and the next sync leaves it alone instead of
silently reverting it an hour later.

Manual entry stays a first-class path, not a legacy one. It is the whole reason
losing the vendor degrades the product rather than blanking it, and it is the
only path for Campaigns on platforms no sync covers.

**Blocked by:** 03 (Unlinked Ads: claim and dismiss).

**Status:** resolved

- [x] A Spend row records its source: typed by the merchant, or written by a sync
- [x] A merchant can tell at a glance which of their Spend rows were typed and
      which were pulled
- [x] The sync writes Spend for a claimed ad against the Ad it was claimed onto
- [x] A sync overwrites an unpinned Spend row for the same day
- [x] **A pinned Spend row is never overwritten by a sync**, and the sync records
      that it declined rather than treating it as a failure. This is the failure
      this design exists to prevent: a merchant reconciles a day against their
      invoice and the next sync reverts it with nothing in the UI saying so
- [x] A merchant pins a day they corrected, and un-pins it to hand it back to the
      sync
- [x] **Stage 5's day-uniqueness guarantee does not regress**: at most one
      Campaign-level row per day and at most one row per Ad per day, with NULLs
      handled explicitly. Re-prove the double-submit cases rather than assuming
      them
- [x] A Campaign's Spend still sums its own rows and its Ads' rows, and the two
      levels still never disagree
- [x] Manual Spend entry works unchanged for every platform, including `email`,
      `sms`, `affiliate`, `influencer` and `other`, which no sync will ever cover
- [x] Spend rows stay editable and deletable regardless of source
- [x] `currency` stays denormalized on the row and there is still no conversion
- [x] Covered by extending the existing Spend coverage, with the pinned-row case
      asserted explicitly

## Comments

Implemented.

**The columns.** `campaign_spend` gains `source` (`spend_source` enum:
`manual` | `synced`) and `pinned` (boolean, default false), in migration
`0020_spend_provenance_and_pinning`. Both are added with defaults and nothing
backfills them: every row that existed before genuinely was typed by a merchant
and had nothing to be protected from. An enum rather than `is_manual`, so a
third source (an import, a bulk upload) is a value rather than a rename of every
reader.

`source` and `pinned` are two columns rather than one because they are
independent facts. A sync winning over an unpinned hand-typed figure is the
_default_ — the alternative is a merchant keeping two sets of books — and
pinning is the merchant saying this particular day is theirs. Folding them
together would have made either "a sync never corrects a hand entry" (and no
merchant would ever stop typing) or "a pin is implied by editing" (and the
merchant could never hand a day back).

**Day uniqueness did not move.** `campaign_spend_campaign_ad_day_unique`
(`UNIQUE NULLS NOT DISTINCT` on `campaign_id, ad_id, day`) is untouched, and
neither new column is part of the key — a synced row sitting beside a manual one
for the same day would be exactly the doubling that constraint exists to
prevent. The double-submit cases are re-proved rather than assumed, now with two
writers in play: recording twice, syncing twice, and a raw insert of a second
row at each grain with a different `source` and `pinned`, all still leave one
row.

**Who may overwrite whom.** The pin guard lives in the SQL, not in a read: the
sync's upsert carries `setWhere (… and not pinned)`, so a day pinned between the
sync's read and its write is still protected. `RETURNING` omits the rows the
guard filtered, which is where the decline count comes from — the sync reports
`spendWritten` and `spendDeclined` as separate numbers and stays `synced`,
because a pinned day is a decision and a connection reporting it as a failure
would show the merchant a problem where there is none. The hand path has no such
guard and must not: a pin binds the sync, never the merchant, so a hand write
always lands and takes `manual` as its source. Correcting an amount through
`PATCH` flips a synced row to `manual` for the same reason — the figure on it is
now the merchant's, and a corrected day still labelled `synced` would claim the
platform said something it did not.

Leaving `pinned` out of a write means "keep whatever the day had" rather than
"false". Correcting the amount of a reconciled day is the commonest way to reach
that write, and quietly handing it back to the sync is the exact revert the pin
was set against.

**The one door into `campaign_spend`.** `SyncedSpendService` lives in
`MarketingModule` — the module that owns what Spend is — and is the only way a
platform figure reaches that table. Ticket 03's note said nothing in
`AdPlatformModule` may inject `CampaignSpendRepository` or
`CampaignSpendService`; that still holds and is still the check to make, now
written alongside the narrower rule that this one collaborator is the door.

What goes through it is spend and nothing else. The platform's reported revenue,
conversions and ROAS stay in `ad_reported_figures`, and Contribution Margin
still never sees them. ADR-0005's opening paragraph has been sharpened to say
where that boundary runs, because "they never overwrite a merchant's own Spend"
was no longer precise once a sync could write an unpinned day.

**What the sync refuses.** It writes only against an Ad that claims the
platform's ad — never a Campaign-level row, whose null `ad_id` means the split
is unknown and is a statement only a merchant can make, and never an invented
Ad. It writes nothing for an ad nothing claims: the money is already in the
platform's book and the ad is already held as an Unlinked Ad. And it writes
nothing at all across a currency mismatch, reporting `spendCurrencyMismatch`
instead — `campaign_spend` is summed as a single currency, so a EUR figure in a
USD store's totals would silently distort every ratio built on it. The Reported
Figures are still pulled and still readable in the currency they are in.

**Two lifecycle consequences, not in the ticket but implied by it.** A scheduled
sync only re-reads a trailing window, so a day backfilled six weeks ago would
never come round again — claiming an Unlinked Ad therefore records its already
pulled days as that Ad's Spend immediately, or the creative's cost would start
from zero and every ratio built on it would be wrong for as long as it ran.
Unlinking withdraws those rows again, because an Ad that no longer claims a
platform ad must stop reporting what that ad spent, and a re-claim onto a
different Ad would otherwise write the same days a second time under a second
name. Both leave every Reported Figure untouched, and leave anything the
merchant typed or pinned exactly where it is.

**Manual entry is unchanged and still first-class.** It is asserted for `email`,
`sms`, `affiliate`, `influencer` and `other`, which no sync will ever cover:
record, range, correct, pin and delete all work there exactly as on a synced
platform. `currency` stays denormalized on the row and nothing anywhere
converts.

**In the admin.** Each spend row carries a Typed/Synced label and, when set, a
Pinned badge — the comparison is the useful reading, so the source label is on
every row rather than only on the pulled ones. The pin is its own toggle on the
row, because a merchant pins a day by looking at it rather than by opening it
for editing and saving nothing, and the edit form also offers "Keep my figure"
so the pin can ride on the same request as the correction it belongs to.

**Coverage.** The existing Spend spec gains a `provenance and pinning` block
driving `SyncedSpendService` directly — the same path the sync uses — and a
hand-entry block over all five unsyncable platforms. The sync spec gains the
full seam: a claimed ad's spend landing labelled `synced`, an unpinned day
corrected rather than doubled, **a pinned day surviving three syncs with the
decline reported**, un-pinning handing it back, a second sync producing the same
rows, a foreign ad account writing nothing, a claim bringing 45-day-old backfill
into the book, and one store's synced spend never reaching another that claims
the same platform ad id. The frontend stays untested, holding the existing
floor.
