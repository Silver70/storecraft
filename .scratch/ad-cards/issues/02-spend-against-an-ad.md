# 02: Spend against an Ad

**What to build:** A merchant records what one creative cost, rather than only
what the whole push cost. Spend can now name an Ad, or name no Ad and belong to
the Campaign as a whole, and a Campaign's Spend for a period is the sum of both.

This ticket lands before per-Ad revenue deliberately. It carries the single most
dangerous change in the stage, and it is safer to land it while nothing depends
on it yet.

**Blocked by:** 01 (Ad as a managed object).

**Status:** ready-for-agent

- [ ] Spend gains an optional Ad. A row naming no Ad means the cost is known and
      its split is not — never that it belongs to no Ad
- [ ] **The day-uniqueness guarantee survives.** Today one row per Campaign per
      day is enforced, which is what makes recording Spend an upsert and what
      makes a double-submit correct a day instead of doubling it. After this
      change there must be at most one Campaign-level row per day **and** at most
      one row per Ad per day
- [ ] Beware the trap: a plain unique constraint including the Ad column does
      **not** deliver this, because Postgres treats NULLs as distinct, so two
      Campaign-level rows for one day would both be admitted. This
      reintroduces exactly the silent doubling the existing constraint prevents —
      a halved ROAS, forever, with nothing thrown. Use `NULLS NOT DISTINCT` or a
      pair of partial unique indexes
- [ ] A double-submit of a Campaign-level figure for one day corrects that day
      rather than doubling it, proven by test
- [ ] A double-submit of an Ad-level figure for one day corrects that day rather
      than doubling it, proven by test
- [ ] A Campaign-level row and an Ad-level row for the same day coexist, and are
      both counted
- [ ] A Campaign's Spend for a period is the sum of its own rows and its Ads'
      rows. The two levels never disagree about what a push cost
- [ ] **The migration invents no Ads.** Existing Spend rows keep no Ad. A
      synthetic "default Ad" would sit in the card grid forever claiming to be a
      creative that never ran
- [ ] Range entry works at the Ad level the way it already does at the Campaign
      level
- [ ] A Spend row remains editable and deletable, unlike a Campaign or an Ad: it
      is a record of what a merchant typed, and a wrong one should be removable
- [ ] `currency` stays denormalized on the row and there is still no conversion
      anywhere in this feature
- [ ] A merchant records and corrects Ad-level Spend from the admin, and the
      figures update without a manual reload
- [ ] Covered end to end alongside the existing Spend coverage, with the
      double-submit cases asserted first
