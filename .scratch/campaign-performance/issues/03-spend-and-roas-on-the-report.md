# 03: Spend and ROAS on the performance report

**What to build:** The Campaign Revenue report becomes a performance report. Every
Campaign line carries the Spend recorded for the period beside the revenue it
earned, and the ROAS between them, so the merchant can rank Campaigns by what
they returned rather than by what they grossed.

Two behaviours matter more than the arithmetic:

**A Campaign that spent money and earned nothing must appear.** Today a Campaign
only makes the report if it is active or earned revenue, so an archived Campaign
quietly burning budget is simply absent — the most actionable row in an ad
account is the one the report cannot currently represent. Recording Spend in the
period becomes a third reason to appear.

**A Campaign with no Spend has no ROAS.** Not zero, not infinity — absent. Email,
organic, and affiliate Campaigns live in this table too, and either substitute
would sort them to an extreme of every ranking.

Revenue itself does not change. It stays the figure Stage 1 reports, so the two
stages reconcile and adding cost moves nobody's revenue numbers.

**Blocked by:** 01 (Record Spend against a Campaign).

**Status:** resolved

- [x] The attributed-revenue read returns, per Campaign, the Spend recorded for the period and the resulting ROAS, and returns blended Spend, revenue, and ROAS across all Campaigns
- [x] Existing fields of that read keep their current names and meanings; revenue for a period matches what the report returned before this ticket
- [x] The period's `[start, end)` timestamp range is converted to start and end calendar dates in the Store's timezone, and Spend rows within those dates are what the period counts
- [x] The shared period-range helper is reused rather than duplicated, so Spend and revenue never describe windows that disagree
- [x] ROAS is a ratio rounded to two decimal places, not a money value, and the code says so plainly enough that nobody later converts it to cents
- [x] ROAS is null when Spend is zero, and zero when there is Spend but no revenue
- [x] A Campaign appears in the report if it is active, **or** earned revenue in the period, **or** recorded Spend in the period
- [x] Unattributed keeps its own line, carries no Spend and no ROAS, and is still never redistributed across Campaigns
- [x] The ROAS arithmetic lives in a pure utility covered by its own spec: zero Spend yielding null, zero revenue with Spend yielding zero, and integer revenue summed across many Orders producing no drift
- [x] The report page shows Spend and ROAS columns, renders `—` for a null ROAS, and makes a Campaign with Spend and no revenue visually distinct rather than merely present
- [x] The Lookback Window is still displayed next to the attributed figures
- [x] The page states that Spend is recorded per day while revenue is recorded to the second, so a partial-day ROAS is not read as a collapse
- [x] Switching between First Touch and Last Touch recomputes ROAS from the same rows
- [x] End-to-end coverage: a Campaign with Spend and revenue reports the expected ROAS; a Campaign with Spend and no revenue appears in the report; a Campaign with revenue and no Spend reports no ROAS; and revenue for a period matches the Stage 1 figures for that period

## Comments

Implemented 2026-09-04.

**The null ROAS is the ticket.** `performance.util.ts` returns `null` for zero
Spend and a real `0` for Spend with no revenue, and says at length why — that is
the decision most likely to be reversed by someone who has not read it, and both
substitutes sort email and organic Campaigns to an extreme of every ranking. The
unit spec asserts the null is neither `0` nor `Infinity` explicitly rather than
only `toBeNull()`, so a "fix" to either has to delete an assertion that names it.
The same file states that ROAS is a **ratio, not money**, and the spec pins it
with `expect(Number.isInteger(roas)).toBe(false)` on a 4.25 — if this ever comes
back as `425`, somebody has converted it to cents.

**Blended is summed then divided, never averaged.** `blendPerformance` adds every
line's revenue and Spend as integers and divides once. A mean of per-Campaign
ratios would let a $5 Campaign with one lucky sale outweigh a $5,000 one; the
spec has that exact pair in it. The sums are taken from the lines the report
actually renders, so the totals on screen are the totals *of* what is on screen.

**One window, converted — not two windows defined.** The service resolves the
period once through `resolvePeriodRange` and hands that same `[start, end)` to
`spendDayRange`, which is ticket 01's helper. Spend and revenue therefore cannot
describe ranges that disagree. The e2e asserts `spendFrom`/`spendTo` are the
report's own `rangeStart`/`rangeEnd` reduced to days, rather than recomputing the
dates in the test — a test that derived them independently would be a second
definition of the window, which is the thing being guarded against. `spendFrom`
and `spendTo` are returned on the report because the two windows are genuinely
different shapes (days against instants) and the page names both.

**The third reason to appear.** A Campaign is on the report if it is active,
**or** earned revenue, **or** recorded Spend in the period. The Spend clause is
what puts an archived Campaign quietly burning budget back on the page. Spend
also breaks the sort tie ahead of order count, so among the lines that earned
nothing the ones costing money sort above the merely idle — that row is the most
actionable in an ad account and should not be found at the bottom of a list of
empty Campaigns.

**Revenue is untouched.** Spend is divided into revenue and never subtracted from
it, and the e2e proves it rather than asserting it in a comment: it reads the
report, records Spend, reads again, and requires every campaign line, the
unattributed bucket and the totals to be identical — then checks the totals still
equal `/dashboard/stats` for the same period. Contribution Margin, which does
change the revenue basis, is ticket 04 and is not here.

**`sumByCampaign` sums in SQL** and returns a `Map`, with Campaigns that spent
nothing simply absent — the caller reads that as zero rather than the query
inventing rows. `::int` because Postgres sums integers as `bigint`, which reaches
the driver as a string; every other summed money column in this codebase casts
the same way.

**Frontend.** The page is now *Campaign performance* (the button on the Campaigns
list says "Performance" to match) with Spend and ROAS columns and five summary
tiles led by Spend, Attributed revenue and Blended ROAS. A Campaign with Spend and
no revenue gets a tinted row, a "No revenue" chip and a destructive-coloured
`0.00×` — visually distinct, not merely present. ROAS renders as `—` when null and
as `4.25×` otherwise, never through `formatMoney`; Spend renders `—` at zero,
because no row recorded is a different statement from a day that cost nothing. The
lookback note keeps its place and gains a second caveat beside it: Spend is
recorded per whole day and revenue to the second, so a ROAS read part-way through
today is not a collapse. The table scrolls horizontally inside the card rather
than crushing seven columns.

**One change beyond the checklist.** The Spend card's invalidation now also drops
`["campaigns", "revenue"]`. Before this ticket nothing read Spend, so invalidating
only the Campaign's own Spend queries was complete; now the report divides Spend
into revenue, and a figure typed on the detail page would otherwise sit stale in a
60-second cache on the report. One line, and it is the story "the Spend I enter is
reflected in the report immediately".

Verified: `npm test` 243 passed (16 suites, +12 in `performance.util.spec.ts`);
`npm run test:e2e` 137 passed (7 suites, +6 in `campaign-revenue.e2e-spec.ts`
plus spend assertions folded into the existing cross-organization test); `nest
build` and backend `tsc --noEmit` clean; frontend `npm run build` (which runs
`tsc --noEmit`) clean; `npx eslint src/modules/marketing test/campaign-revenue.e2e-spec.ts`
clean; `prettier --check` clean on every file touched except
`campaign-spend-card.tsx`, which is left in its own 4-space/120-column style as
ticket 02 recorded. The page was not exercised in a browser — there is none in
this session — so its verification is the type-check, the build, and the API
underneath it.

**Out of scope, as specified.** No Contribution Margin, no cost coverage, no
sorting control, and no dashboard card — tickets 04 and 05. The Campaign detail
page still shows Spend without its own ROAS; that is ticket 06.
