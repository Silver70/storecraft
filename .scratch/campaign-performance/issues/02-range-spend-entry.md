# 02: Enter Spend across a date range

**What to build:** A merchant who knows a week's total but not each day's types
one figure with a start and end date, and gets one Spend row per day in that
range.

The daily rows must sum to **exactly** the total typed. Dividing integer minor
units across a range leaves a remainder, and it is added to the first day rather
than dropped or spread — money that does not add up is worse than money that is
unevenly distributed.

A range entry overwrites any existing rows for the days it covers, consistent
with the correction semantics ticket 01 established.

**Blocked by:** 01 (Record Spend against a Campaign).

**Status:** ready-for-agent

- [ ] An admin endpoint records Spend across a date range for one Campaign, writing one row per day
- [ ] The rows written sum to exactly the total submitted, with the remainder on the first day
- [ ] The range overwrites existing rows for days it covers rather than adding to them
- [ ] The same validation as single-day entry applies: no negative totals, no future dates, Store currency only
- [ ] An inverted range (end before start) is rejected
- [ ] The Campaign detail page offers range entry alongside single-day entry, and the rows it writes appear immediately in the list
- [ ] The remainder split is covered as a pure unit alongside the existing marketing utility specs — a total that divides unevenly across its days still sums to the original
- [ ] End-to-end coverage: a range entry writes the expected number of rows summing to the exact total, and re-running it over overlapping days corrects rather than doubles
