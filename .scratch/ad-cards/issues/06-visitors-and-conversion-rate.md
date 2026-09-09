# 06: Visitors and conversion rate

**What to build:** A merchant can tell a creative nobody clicked from one that
was clicked and did not convert. Visitors and conversion rate join the card,
visually demoted and labelled, because they come from a different and weaker
source than everything beside them.

**Blocked by:** 05 (The merged page and the card grid).

**Status:** resolved

- [x] Visitors and conversion rate are reported per Ad and per Campaign, joined
      from the tracked event stream on the Campaign Tag, the Ad Tag and the
      visitor identity
- [x] Conversion rate is purchases over visitors
- [x] Both are **absent, not zero**, when the event stream has nothing for a
      Campaign or Ad. A zero would read as "nobody came" where the truth is "we
      did not see anyone"
- [x] **The measured figures are visibly distinguished from the order-derived
      ones on the card.** Revenue, purchases, Spend, ROAS and margin come from
      Orders. Visitors and conversion rate come from a stream that is
      ad-blockable and is eventually deleted by the retention purge. Presenting
      them in identical typography implies they are equally solid; when ad
      blockers eat a third of traffic, conversion rate reads far higher than it
      is and the merchant optimises toward a fiction
- [x] The distinction follows the convention this codebase already uses for a
      qualified number — cost coverage beside Contribution Margin, the Lookback
      Window beside ROAS, Declared beside Correlated Attribution
- [x] The figures are returned in a shape that marks them as measured, so the UI
      cannot present them identically to order-derived figures by accident
- [x] The join is scoped to the Organization and Store like every other read
- [x] Adding these figures does not change any order-derived figure on the page

## Comments

Implemented 2026-09-09.

**The stream could not name a creative, so it does now.** `analytics_events`
has carried `utm_campaign` since Phase 2 but never `utm_content`, which meant a
click could only ever be resolved as far as a Campaign — every Ad would have
reported the whole push's audience as its own. Migration 0016 adds the column,
the ingest DTO accepts it, and `ca.js` captures it from the query string
alongside the rest of the tuple and holds it for the session, so every event of
a visit reports against the same Ad rather than only the landing hit. Nothing is
backfilled: an event ingested before the column existed did not carry the tag,
and inventing one would credit a creative with visitors nobody can show it had.
Those events keep counting toward their Campaign and are simply absent from the
split beneath it — which is exactly what an untagged link produces, so the two
cases read the same way on screen because they are the same case.

**Distinct triples, not a grouped count.** `TrafficRepository` returns every
distinct `(utm_campaign, utm_content, visitor)` row rather than a `COUNT` per
tag pair, and that is the load-bearing decision. Matching normalizes both sides,
so `Summer_Sale` and `summer-sale` are one Campaign; a query that grouped before
resolving would make them two, and a visitor who arrived under both would be
counted twice. Resolution therefore has to happen where it already happens — in
the matcher — so the rows arrive unresolved. Events with no `utm_campaign` are
dropped in SQL, which is the large majority of a Store's traffic and can never
resolve to a Campaign anyway. There is no `LIMIT`: a truncated read would
understate the denominator and silently inflate every conversion rate above it,
which is the precise failure this ticket exists to prevent.

**The same two matchers, over the same rules.** `tallyVisitors` takes the
`CampaignMatcher` and the `AdMatcher` the money already went through — the
service builds each once and hands both to both tallies. A second resolution
built for traffic would be free to disagree with the one revenue used, and a
creative whose revenue and whose visitors were resolved by different rules is
worse than one with no visitors at all. ADR-0004's property therefore holds on
the traffic side structurally rather than by a second check: an Ad can no more
claim a sibling Campaign's visitor than its sale, and two Campaigns each running
a `video-a` stay apart. The Lookback Window is not applied here and cannot be —
it measures backwards from an Order, and a visit that never became one has
nothing to measure from.

**Visitors do not subdivide, and the shape says so.** Revenue splits because an
Order belongs to exactly one Ad; an audience overlaps because a person can click
two creatives. So the Ads' visitor counts do not sum to the Campaign's, and
`unassigned` carries **no measured pair at all** — a residue invites a
subtraction, and there is none here that holds. This is the one place the
measured figures deliberately break the reconciliation rule the rest of the
report keeps, and the absence of the unassigned figure is what stops a merchant
discovering that by arithmetic.

**Nested, so the UI cannot get it wrong by accident.** The pair leaves the
backend as its own `measured: MeasuredTraffic | null` object rather than as two
more fields on `PerformanceFigures`. `PerformanceFigures` is untouched, which is
also what makes "changes no order-derived figure" true by construction rather
than by test — there is no way to spread the measured pair into the list of
order-derived ones without noticing you are doing it. `FigureList` stays
order-derived only and a separate `MeasuredPair` renders the demotion: smaller,
lighter, unbolded, behind a dashed rule, under a `Measured` label, with the
caveat sitting against the figures the way cost coverage sits against margin.
In the dense table the same demotion is made with column order — the two sit at
the far right past every order-derived column, behind the same dashed rule, with
`measured` in their headers.

**Absent is a rendered state, not a blank.** Null shows "No tracked visits in
this period. Not the same as no visitors." on the card and an em dash in the
table. That line appears on every card for a Store with no tracker embedded,
which is the majority state today and is the point: it says the measurement is
missing rather than saying the traffic was.

**One decimal, and no cap.** `pctOneDecimal` moved into `percent.util.ts` beside
`pct` and the analytics module's `trueConversionRatePct` now calls it, so the
two conversion rates in this codebase cannot drift. Whole numbers were wrong
here: a real rate lives between 0.5% and 4%, so most of the range would collapse
onto 1% and 2% and a genuine 0.4% would render as 0% — the same thing the report
shows when nobody bought at all. The rate is not capped either, so a mis-tagged
Store showing 150% is visible rather than tidy: the measurement is broken, not
the shop.

**Coverage.** `traffic.util.spec.ts` exercises the tally as a pure unit — a
visitor is a person and not a row, four spellings of one tag are one Campaign,
one visitor of two creatives counts once per grain, an Ad never takes a sibling
Campaign's visitor, and absent is `undefined` rather than `0`. Seven cases join
`ad-revenue.e2e-spec.ts` at the existing full-length seam: visits arrive through
the public ingest API the way the tracker posts them, and the figures are read
back off the same admin report, against numbers worked out by hand. They cover
the split at both grains, absence versus a real zero, the untagged visitor, two
Campaigns each running a `video-a`, bot exclusion, a before/after read proving
no order-derived figure moves, and a second Organization whose identically
tagged traffic never reaches the first's report.

**Not done here, deliberately.** The Campaign detail page's performance panel
still shows the three order-derived figures 02 gave it; the API returns the
measured pair on every line, so adopting it there is a presentation change with
no read behind it. `analytics_daily_metrics` gains no campaign/ad dimension —
that is the traffic sparkline's ticket, and it is what would make these figures
survive the retention purge as a trend rather than as a snapshot.

**One pre-existing failure got louder.** Every creative-upload e2e case fails
with a 400, including in `admin-campaigns.e2e-spec.ts`, which this ticket never
touched. The cause is `@nestjs/common` 11.1.23's `FileTypeValidator`, which now
verifies magic numbers by dynamically importing the ESM `file-type` package;
under Jest that import throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` and
the validator falls through to invalid. It is a test-environment failure only —
running the e2e suite with `NODE_OPTIONS=--experimental-vm-modules` is the fix,
and it is left for whoever owns that decision. The `inline-edit` failure 04
recorded is still there. Everything else is green: 324 unit tests and the rest
of the e2e suite.
