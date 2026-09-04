# 05: Attributed revenue by Campaign

**What to build:** The merchant can finally answer the question this whole feature exists for — which Campaign produced revenue.

A report shows, for a chosen period, the revenue and Order count attributed to each Campaign, with Unattributed as its own visible line so the merchant can judge how much of the total the attributed figures cover. A toggle switches between First Touch and Last Touch. The active Lookback Window is shown on screen, because it is why these numbers differ from what an ad platform reports.

Orders are resolved to Campaigns at read time by running the matching rules, per the confirmed decision recorded in ADR-0001 and ADR-0002. This is what lets a Campaign created after its ads already ran still claim its history, and lets a corrected matching rule repair past reports rather than only affecting future Orders. Touches older than the Lookback Window do not qualify. Bot traffic is excluded, matching the exclusion already applied across every existing event query. Attributed revenue counts the same Order statuses the existing sales reports treat as realized revenue, so the figures reconcile.

**Blocked by:** 02, 04

**Status:** resolved

- [x] The report lists revenue and Order count per Campaign for a selected period
- [x] Unattributed revenue appears as its own line and is never spread across Campaigns
- [x] Switching between First Touch and Last Touch changes the attribution without any data migration
- [x] The active Lookback Window is displayed alongside the figures
- [x] A Campaign created after its Orders were placed claims those Orders on the next read
- [x] Adding a matching rule repairs historical figures rather than only affecting new Orders
- [x] A Touch older than the Lookback Window does not receive credit
- [x] Bot traffic never appears to have driven a sale
- [x] Totals reconcile with the existing sales reporting for the same period
- [x] Revenue is returned in the smallest currency unit and is not formatted server-side

## Comments

Implemented 2026-09-04.

**The credit decision is a pure function, and the query is deliberately dumb.**
`src/modules/marketing/utils/attributed-revenue.util.ts` —
`campaignCreditFor(order, matcher, lookbackDays)` returns a campaign id or null,
and `tallyAttributedRevenue` sums the result. Everything that can silently
withhold credit lives there in one readable place: the bot flag, the Lookback
Window, and the matcher from ticket 04. Resolving a tuple in SQL was possible —
both sides normalize — but only as something no one could read or unit test, and
this is the part of the feature that fails without throwing.
`AttributionRepository` therefore returns rows, not aggregates.

**Three things deny a Campaign credit; none of them deny the revenue.** No
qualifying Touch, a Touch older than the window, and a bot all land the Order in
Unattributed while still counting in `totals`. That is what makes the figures
reconcile with the sales reports, and it is asserted both as a pure invariant
(attributed + unattributed === totals) and against the live dashboard and
analytics endpoints for the same period.

**The window is measured against the Order, not the clock.** A Touch is
disqualified for being more than `lookbackDays` before _the purchase_, so
re-reading last month's report next month returns the same answer. A Touch
timestamped slightly _after_ its Order is clock skew between a storefront and
the server, not a stale visit, so only the older side of the window disqualifies.

**Bot exclusion reads the event log, because the Order carries no device.** The
`analytics_events` classification (`device_type = 'bot'`, the same exclusion
every other event query applies) is looked up by the session or visitor id the
Order froze. Matching on either is deliberate — the session is the tighter join,
but a visitor flagged as a bot on any session should not be crediting an ad.
This is the one read-time dependency on raw events, and it is a _suppression_:
after the retention purge the flag is gone and the Order attributes normally,
which is a degradation toward the ordinary case rather than a loss of history.

**Which campaigns appear.** Every active Campaign, including at zero — "this
push produced nothing" is exactly what the report is read to find out — plus any
archived one that earned something in the period. Archiving retires a Campaign
from the list; it does not disown the Orders it explains. Sorted by revenue,
then order count, then name.

**API.** `GET /api/admin/marketing/attributed-revenue?period=&touch=` under
`campaigns.read`. Its own controller rather than `admin/campaigns/revenue`: a
static segment beside `:id` is a route conflict waiting for someone to reorder
the file, and Marketing will grow Spend and ROAS next. Returns per-Campaign
revenue and order counts, the Unattributed bucket as a separate field (not a row
that could be mistaken for a Campaign), the totals, the resolved range, and
`lookbackDays`.

**Lookback window.** `ATTRIBUTION_LOOKBACK_DAYS`, default 30, capped at 365,
resolved by a pure function in `src/shared/attribution/lookback.ts` that falls
back rather than throwing — a malformed environment variable should change the
report's window, not stop the application booting. Ticket 07's correlation
fallback reads the same value.

**Admin UI.** A new Attributed revenue page at `/admin/campaigns/revenue`,
linked from the Campaigns header. Period tabs, a First/Last Touch toggle that
names what each one credits, three summary tiles (realized / attributed /
unattributed, with attributed coverage as a percentage), and a table with
Unattributed as its own line below the campaigns, visually set apart. The active
lookback window is on screen next to the toggle with the reason it matters, per
the spec's insistence that the difference from an ad platform stay legible.

**One environment fix was unavoidable.** `createPgPool` now pins the session to
`timezone=UTC`. Every `timestamp` column here means a UTC instant — Drizzle
writes them that way and node-postgres reads them back that way — except
`defaultNow()`, which Postgres evaluates in _its_ timezone. On this machine
(server TZ `Indian/Maldives`) `orders.created_at` landed five hours ahead of the
range every date-filtered report queries, and the report returned nothing. This
was not new: the dashboard and analytics sales reports have the same skew on any
non-UTC Postgres. Neon serves UTC, so production was never affected; this makes
local behave the same.

**Tests.** `attributed-revenue.util.spec.ts` (16 tests) and `lookback.spec.ts`
(5) as pure units — every route to Unattributed, both edges of the window, the
bot exclusion, the arithmetic, and the reconciliation invariant, with no
database. `test/campaign-revenue.e2e-spec.ts` (9 tests, seam 1) drives the
whole claim: sales arrive through the storefront GraphQL API carrying UTM tags,
are advanced to `paid` through the real admin status endpoint, and are read back
through the admin REST API. It covers revenue and counts per campaign,
Unattributed as its own line, the First/Last toggle over the same rows, a
Campaign created after its Orders claiming them, a rule added afterwards
repairing history, a 60-day-old Touch getting nothing, a crawler classified
through the real ingest API getting nothing, reconciliation against the live
dashboard and analytics endpoints, and two Organizations whose identically named
Campaigns never see each other's revenue.

`test/helpers/admin-fixture.ts` gained `createAdminUser` / `destroyAdminUsers`
so a storefront fixture's Organization can also be reached through the admin
API — `seedAdmin` now composes them.

Verified: `npm test` 155 passed (11 suites); `npm run test:e2e` 50 passed (5
suites); `tsc --noEmit` clean and eslint clean on everything touched; frontend
`npm run build` (which runs `tsc --noEmit`) clean.

**No migration.** Attribution is resolved from columns ticket 02 already landed,
per ADR-0001 — there is deliberately still no `campaign_id` on `orders`.

**Pre-existing failures untouched.** `npm run lint` still fails on seven
`@typescript-eslint/unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`, and `matching-rules-card.tsx` still fails
`prettier --check` on the frontend. None of them is touched by this ticket, and
the lint script runs `eslint --fix`, so running it reformats unrelated files.
