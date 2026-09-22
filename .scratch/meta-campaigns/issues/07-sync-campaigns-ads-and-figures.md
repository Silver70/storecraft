# 07: Sync campaigns, ads and their daily figures

**What to build:** The connected ad account's reality, mirrored here on its own.
Campaigns and ads the merchant built in Ads Manager appear without anyone
importing them, and what the platform charged for each ad each day is recorded
against it, so no one ever types a figure again.

A discovered campaign is simply inserted. There is no claim queue and no pending
state: the previous design held ads back because cost with no revenue reads as
catastrophic failure, and this design answers that by reading each ad's link
tags and marking the campaign's revenue **unknown** rather than zero.

The sync is the only thing that may be slow or fail, so it never sits in a read
path. A failure is recorded and shown; the page keeps serving the figures it
already had.

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] A scheduled job syncs each connected Store hourly, and the same method is
      callable directly by a Refresh action and after an edit made here
- [ ] Connecting backfills the history the platform offers rather than starting
      from today
- [ ] Campaigns and ads present on the ad account but not here are inserted with
      their names, schedules, formats and platform ids
- [ ] Spend, impressions and clicks land per Ad per day, spend in minor units
      converted at the adapter edge with a tested rounding rule and no float
      reaching a service or repository
- [ ] Running the same sync twice produces the same rows, not doubled ones
- [ ] Each sync re-reads a trailing window as well as everything since the last
      success, because the platform restates recent days
- [ ] Status collapses to Active, Paused, In review, Needs attention or Ended
      from the platform's separate delivery, review and schedule signals, and is
      unit-tested against each combination
- [ ] A campaign deleted on the platform reads Ended and keeps its history
- [ ] Each new ad's link tags are read once and the campaign is marked Tracked
      only when every one of its ads carries ours
- [ ] Creatives are copied into our own storage on first sight, because the
      platform's image links expire within about a day
- [ ] A failure records the time, the error and a failure count on the
      connection, backs off rather than retrying hard, and never throws into a
      merchant's read
- [ ] A failure message never blames the merchant's own account, since some
      upstream quotas are shared across every customer of the vendor
- [ ] The last successful sync time is readable for display
- [ ] An end-to-end spec drives discovery, idempotency, backfill, the Tracked
      flag and a provider failure through the real sync against a real database
