# 02: Sync Reported Figures

**What to build:** A scheduled job pulls what the ad platform knows. For each
connected Store it reads the ad tree and records, per platform ad per day, what
the platform says was spent, shown, clicked and converted, plus the platform's
own reported revenue and ROAS. On a first connection it backfills the history the
platform offers, so the feature is useful on day one.

Figures are keyed by the **platform's ad id**, not by one of our Ads. Nothing is
linked yet — that is ticket 03 — and keying it this way is what lets a claim
later attach history for free rather than needing a second pass.

A merchant can see when the last sync succeeded, and can see when one failed.

**Blocked by:** 01 (Connect a Store to an ad platform).

**Status:** resolved

- [x] A scheduled job pulls the ad tree per connected Store, using the scheduling
      the reservation-expiry, low-stock and analytics rollup jobs already use
- [x] The sync is a plain public method the schedule calls, so it can be invoked
      directly without involving the scheduler
- [x] Reported Figures are stored per platform ad per day, carrying spend,
      impressions, clicks, conversions, the platform's reported revenue and its
      own ROAS, with the source and the currency denormalized onto the row
- [x] **Reported Figures are never written into `campaign_spend`.** That table is
      the merchant's book of record; this one is the platform's (ADR-0005)
- [x] A first connection backfills the history the platform offers rather than
      starting from today
- [x] **The sync is idempotent.** Running it twice over the same range produces
      the same rows, not doubled ones — proven by test
- [x] **Money is converted to minor units in the adapter, at the edge.** The
      vendor reports decimal amounts, and whole currency units for budgets,
      against this codebase's integers-only rule. The rounding rule is explicit
      and tested at boundary values, and no float reaches a service, a repository
      or a report
- [x] A figure in a currency other than the Store's is stored as **that**
      currency. There is no conversion anywhere, and no exchange rate is fetched,
      inferred or hard-coded (ADR-0005)
- [x] The last successful sync time is recorded per connection and shown to the
      merchant, so a stale figure is legibly stale
- [x] **A provider failure is logged and surfaced on the page, never thrown into
      a merchant's read path.** A vendor outage costs freshness, not the
      dashboard
- [x] Previously pulled figures stay readable through a failed sync
- [x] The sync backs off rather than retrying hard. Some upstream quotas are
      shared across all of the vendor's customers and cannot be bought out of, so
      a refusal may have nothing to do with this Organization — and the message a
      merchant sees must not blame their own account
- [x] A merchant can trigger a sync by hand without waiting for the schedule
- [x] Reported Figures are scoped to their Organization and Store
- [x] Covered by a new end-to-end spec: the fake provider returns a tree, the real
      sync runs against a real database, and the merchant reads the result back
      through the admin API
- [x] **Do not test that the schedule fires.** That is the framework's behaviour,
      not ours


## Comments

Implemented. The sync is `AdPlatformSyncService`
(`apps/backend/src/modules/ad-platform/services/ad-platform-sync.service.ts`).
`@Cron('0 */6 * * *')` is a one-line delegation to `syncAllConnections()`, a
plain public method, so every test invokes the method and none asserts that the
schedule fires. `syncStore()` is the same work for one Store, which is what the
merchant's Sync now button calls.

`ad_reported_figures` (migration `0018_reported_figures`) holds one row per
platform ad per day per connection, carrying spend, impressions, clicks,
conversions, the platform's reported revenue and its own ROAS, with the platform
and the ad account's currency denormalized onto the row. There is deliberately
no `ad_id` column: figures are keyed on the platform's ad id, which is what lets
ticket 03's claim attach history for free by matching `ads.external_id`. The
unique constraint on `(connection_id, external_ad_id, day)` is the idempotency —
a sync re-asks for a trailing week every run, because platforms restate, and the
upsert makes that a correction rather than a doubling. `campaign_spend` is not
reachable from this module at all, which is ADR-0005 made structural.

Money converts to minor units in the adapter, at the edge
(`utils/reported-money.util.ts`), rounding halves away from zero after
normalizing to 15 significant digits — `2.675` becomes `268` rather than `267`,
which is the boundary the spec is built around. A non-finite amount throws
rather than storing zero, because "this ad spent nothing today" is a claim. No
float exists above the adapter: every field on `ReportedAdDay` is already an
integer by type.

A first connection backfills (`utils/sync-window.util.ts`), asking the provider's
`health()` how much history this platform offers and taking the smaller of that
and 90 days. Every sync afterwards asks for the last 7 days, capped at 400 days
for any one request.

A failure is recorded on the connection — `last_sync_error`,
`sync_failure_count`, `sync_paused_until` — and returned as a `SyncOutcome`,
never thrown: the manual trigger answers 201 with `status: 'failed'` and a
sentence, previously pulled figures stay readable, and `last_synced_at` keeps
pointing at the last success so a stale figure is legibly stale. Backoff doubles
from 15 minutes to a 12-hour cap and only holds the *schedule*; a merchant
pressing the button is never held by it. The merchant-facing sentences never
mention their account, because the refusal is usually a quota shared across
every one of the vendor's customers.

Reads are `GET /api/admin/ad-platforms/reported-figures` (`ad_platforms.read`)
and the sync is `POST /api/admin/ad-platforms/sync` and
`POST /api/admin/ad-platforms/:platform/sync` under a new `ad_platforms.sync`
permission, which a product manager holds — refreshing figures is not granting
access. The settings panel shows when each platform last synced, shows the
failure sentence when there is one, and has a Sync now button.

Covered by `test/ad-platform-sync.e2e-spec.ts` (21 cases): the fake provider
returns a tree, the real sync runs against a real Postgres database, and the
merchant reads the result back through the admin API. Asserted there: the
backfill asks for history rather than today, a second run produces the same rows
rather than doubled ones, a restated day is corrected, a EUR figure is stored as
EUR against a USD store with no rate anywhere, `campaign_spend` stays empty, no
Ad is created for an unclaimed platform ad, a provider failure is surfaced while
the previous figures stay readable, the connection backs off and the schedule
skips it, and neither another Organization nor another Store of the same one can
see any of it. Pure unit specs cover the rounding rule at its boundary values and
the window and backoff arithmetic.

Ticket 03 inherits the unclaimed ads this sync already sees: the figures are
there, keyed by platform ad id, waiting for an Unlinked Ad record to hold them.
