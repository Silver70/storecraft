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

**Status:** resolved

- [x] A scheduled job syncs each connected Store hourly, and the same method is
      callable directly by a Refresh action and after an edit made here
- [x] Connecting backfills the history the platform offers rather than starting
      from today
- [x] Campaigns and ads present on the ad account but not here are inserted with
      their names, schedules, formats and platform ids
- [x] Spend, impressions and clicks land per Ad per day, spend in minor units
      converted at the adapter edge with a tested rounding rule and no float
      reaching a service or repository
- [x] Running the same sync twice produces the same rows, not doubled ones
- [x] Each sync re-reads a trailing window as well as everything since the last
      success, because the platform restates recent days
- [x] Status collapses to Active, Paused, In review, Needs attention or Ended
      from the platform's separate delivery, review and schedule signals, and is
      unit-tested against each combination
- [x] A campaign deleted on the platform reads Ended and keeps its history
- [x] Each new ad's link tags are read once and the campaign is marked Tracked
      only when every one of its ads carries ours
- [x] Creatives are copied into our own storage on first sight, because the
      platform's image links expire within about a day
- [x] A failure records the time, the error and a failure count on the
      connection, backs off rather than retrying hard, and never throws into a
      merchant's read
- [x] A failure message never blames the merchant's own account, since some
      upstream quotas are shared across every customer of the vendor
- [x] The last successful sync time is readable for display
- [x] An end-to-end spec drives discovery, idempotency, backfill, the Tracked
      flag and a provider failure through the real sync against a real database

## Comments

Done. Backend `tsc`, `nest build`, `npm test` (444 unit specs) and the frontend
build are green, and `eslint` is clean over everything touched. The rewritten
`ad-platform-sync.e2e-spec.ts` has 33 specs, all passing. `npm run test:e2e`
has one failure, `inline-edit.e2e-spec.ts`. It is the assertion tickets 01–06
each recorded (an exact object that has since gained `canEditContent`), and it
fails on a clean `main` too. In one of three full runs, `purchase-events.e2e-spec.ts` also failed: two
tests hit the 60 s timeout. It passed in the other two full runs, alone, and in
three runs beside this ticket's spec and the checkout spec, so the cause is
still unknown. Watch for it. `npm run lint` reports only the same 7 pre-existing
`unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`.

The sync is `AdPlatformSyncService.syncConnection`, now hourly. It writes
through a new `CampaignMirrorRepository`, which is the only writer of
Campaigns, Ads and `ad_daily_figures` for what the platform reports. The status
collapse is `utils/platform-status.util.ts`, with a spec over all 175
delivery × review × schedule combinations. The Link Tag template and the check
that decides Tracked are both in `utils/link-tags.util.ts`, so ticket 11 writes
the same spelling the sync looks for.

Judgement calls not on the checklist:

**The vendor's OpenAPI spec answered what ticket 04 left open.**
`docs.zernio.com/api/openapi` documents the tree's per-node fields, and the
adapter now follows it:

- Ads are keyed on `platformAdId` only, which the spec guarantees on tree
  nodes. The `_id` fallback is gone. That is the vendor's own document id,
  `{{ad.id}}` never expands to it, and a row keyed on it would never be
  credited a sale.
- `clicks` is **not** read. The spec's `inlineLinkClicks` is Meta's own
  "Link clicks" column, and `actions.link_click` is the fallback. The bare
  `clicks` field is Meta's clicks (all). This settles which field to read.
  Ticket 13 still has to confirm the figure against a live account.
- The tree is paginated by campaign (100 per page), and every page is read.
- Deleted objects stay in the tree as `cancelled`, and the campaign's own
  `platformCampaignStatus` (`DELETED`/`ARCHIVED`) is authoritative about
  deletion.
- An ad's tags are a separate call, `GET /v1/ads/{adId}/tracking-tags`, which
  is why they are read once rather than on every sync.

**Connecting runs the backfill, and waits for it.** `selectAccount` calls the
sync before it answers, so the merchant lands on a page that already has
figures and a freshness time. This includes the one-account shortcut on the
return trip. The sync reports rather than throws, so the backfill cannot fail
the connection. A failed one leaves `lastSyncedAt` null, so the next sync is
still the backfill. The cost is a slower connect for a large account. If that
turns out to matter, detach it. The sync is already safe to run beside the
hourly job.

**"History still being gathered" is its own outcome, `partial`.** For a while
after an account is first connected, the vendor answers `202` with
`backfillPending: true`. What arrived is written. The range is not counted as
covered: `lastSyncedAt` does not move, and a non-blaming sentence is recorded
with backoff. Without this, the first sync would count a half-empty 90 days as
done, and every later sync asks only for a trailing week, so those days would
stay empty for good. The admin's Refresh note shows the sentence rather than
"Up to date."

**A campaign the platform stops reporting is Ended, but only after a complete
read.** The tree returns every campaign on the account whatever the date range,
so an absence from a complete read means the platform let go of it. It is
marked Ended and keeps its figures. A later sync that sees it again writes its
real status back. A partial read ends nothing.

**Restated days are replaced, not only upserted.** Within the window a sync
owns, a day the platform no longer reports for an ad is removed, so a day
restated to nothing does not keep yesterday's spend. Days outside the window
are never touched. The removal goes by write stamp (after the upsert) rather
than delete-then-insert. The production driver cannot hold a transaction, and
this order means a failure between the two statements leaves the old figures
standing rather than a hole.

**Precedence in the status collapse**, first match wins: Ended (deleted,
completed, or past its end) → Paused → Needs attention (rejected, with issues,
error) → In review → Active. Two of these are choices:

- A pause outranks a rejection, because a paused ad is not spending and the
  pause was the merchant's own decision.
- A campaign scheduled to start later reads **Active**, not Paused. It is
  switched on and will deliver, and calling it Paused would tell a merchant
  they turned off something they did not.

An unrecognised vendor status reads Needs attention rather than Active.

**A campaign's schedule is the span of its ads' schedules.** Meta's campaign
has no flight of its own in the tree; the flight lives on the ad sets. The
campaign starts at its earliest ad's start. It is open-ended if any ad is,
otherwise it ends at the latest ad's end.

**Tracked is strict: every ad, deleted ones included.** A campaign with no ads
is Not Tracked. Ticket 10 should note that a deleted ad cannot be retagged, so
a campaign with an untagged deleted ad can never become Tracked under this rule.
If that turns out to matter, the rule to change is the one query in
`refreshTracked`.

**Per-ad work is bounded and best-effort.** Each sync makes at most 100
link-tag reads and 50 creative copies; the rest follow on the next sync.

- A tag read that fails stops the tag reads for that sync, since the likely
  cause is a shared quota. The ad stays owed (`ads.link_tags_checked_at` is
  null, the one new column) and its campaign reads Not Tracked until it is
  read.
- A creative copy that fails is retried on the next sync, one ad at a time.
  An expired link says nothing about the next one.

Neither kind of failure fails a sync whose figures have already landed.

**Creatives go through the provider seam** (`fetchCreative`). Like
`readLinkTags`, it is a read, and it carries no credential: Meta's image links
are signed on their own. Copies land in object storage at
`ad-creatives/{org}/{store}/{ad}.{ext}`. The Cover is filled only when it is
empty, from the highest-spending ad that has a copied creative. Once set, the
sync never replaces it, so ticket 12's cover choice is safe.

**The adapter has a unit spec of its own**, `zernio.adapter.spec.ts`, against a
stubbed `fetch`. It covers the translation that nothing else in the codebase
would notice going wrong: link clicks over all clicks, deletion, pagination,
`202`, ids, and the rounding rule on a real spend value. It is the second file
that imports the adapter by name, alongside the contract spec.

**Deployment needs `npm run db:migrate`** for
`0029_sync_campaigns_ads_and_figures`, one additive nullable column on `ads`.
It has been applied to the local test database by the e2e suite's global setup
and **not** to the hosted one. The creative copies need the existing
`STORAGE_*` settings, which product media already requires.

**Still to confirm against a live account**, as before: nothing here has run
against a real Zernio account, because the configured one still has no
connected accounts. A live run would settle three things. Do Meta's ad ids
arrive in `platformAdId` on tree nodes, as the spec says? Does
`inlineLinkClicks` match Ads Manager's "Link clicks" (ticket 13)? And does the
tracking-tags read return `urlTags` with the macros unexpanded?
