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

**Status:** ready-for-agent

- [ ] A Spend row records its source: typed by the merchant, or written by a sync
- [ ] A merchant can tell at a glance which of their Spend rows were typed and
      which were pulled
- [ ] The sync writes Spend for a claimed ad against the Ad it was claimed onto
- [ ] A sync overwrites an unpinned Spend row for the same day
- [ ] **A pinned Spend row is never overwritten by a sync**, and the sync records
      that it declined rather than treating it as a failure. This is the failure
      this design exists to prevent: a merchant reconciles a day against their
      invoice and the next sync reverts it with nothing in the UI saying so
- [ ] A merchant pins a day they corrected, and un-pins it to hand it back to the
      sync
- [ ] **Stage 5's day-uniqueness guarantee does not regress**: at most one
      Campaign-level row per day and at most one row per Ad per day, with NULLs
      handled explicitly. Re-prove the double-submit cases rather than assuming
      them
- [ ] A Campaign's Spend still sums its own rows and its Ads' rows, and the two
      levels still never disagree
- [ ] Manual Spend entry works unchanged for every platform, including `email`,
      `sms`, `affiliate`, `influencer` and `other`, which no sync will ever cover
- [ ] Spend rows stay editable and deletable regardless of source
- [ ] `currency` stays denormalized on the row and there is still no conversion
- [ ] Covered by extending the existing Spend coverage, with the pinned-row case
      asserted explicitly
