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

**Status:** ready-for-agent

- [ ] A `campaign_spend` table exists, tenant-scoped with `organization_id` as its second column and also scoped by `store_id`, holding a Campaign reference, a calendar `day`, an integer `amount` in minor units, a three-letter `currency`, an optional note, and timestamps
- [ ] A unique constraint on `(campaign_id, day)` makes the database, not the read that preceded the write, the authority on one-row-per-day
- [ ] Currency is stored on the row rather than read from the Store at report time, so a later Store currency change cannot reinterpret historical Spend
- [ ] Recording Spend for a day that already has a row updates that row; the same request sent twice leaves one row with the amount from the last request
- [ ] A Spend row can be updated and deleted through the admin API
- [ ] A Campaign's Spend rows for a period can be listed through the admin API
- [ ] Negative amounts are rejected
- [ ] Dates in the future (relative to the Store's timezone) are rejected
- [ ] Spend in a currency other than the Store's is rejected — there is no conversion anywhere in this feature
- [ ] Spend can be recorded against an archived Campaign
- [ ] Writes require `campaigns.write` and reads require `campaigns.read`, so a support agent cannot alter cost data
- [ ] Spend rows go through the tenant-scoped repository base, and row-level security covers the table as it does campaigns and matching rules
- [ ] The Campaign detail page has a Spend section: the rows for the selected period, single-day entry, and inline edit and delete
- [ ] Amounts are formatted only at the edge, through the existing frontend money helper
- [ ] End-to-end coverage in the existing harness against local Postgres: a row is recorded and read back; re-recording the same day corrects rather than doubles; update and delete take effect; negative amount, future date, and foreign currency are all rejected; and Spend never crosses an Organization boundary
