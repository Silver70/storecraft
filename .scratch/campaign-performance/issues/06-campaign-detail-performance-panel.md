# 06: Performance panel on the Campaign detail page

**What to build:** A merchant looking at one Campaign sees how that Campaign is
doing without going back to the table — its Spend for the period, its ROAS, and
its Contribution Margin with coverage, sitting alongside the Spend rows they
entered in ticket 01.

This is the loop closing: record a cost on this page, and see what it did to
this Campaign's return on the same page.

The figures come from the same read the report is computed from, filtered to one
Campaign. No second calculation and no second definition of a period — a
Campaign's numbers here and its row in the table must be the same numbers.

**Blocked by:** 04 (Contribution Margin and cost coverage).

**Status:** resolved

- [x] The Campaign detail page shows that Campaign's Spend, ROAS, and Contribution Margin with coverage for the selected period
- [x] The figures are derived from the same read that produces the report, not recomputed
- [x] The period and touch selection behave the same as on the report
- [x] The null states are respected here too: `—` for a ROAS with no Spend, "no cost data" for a margin with no coverage
- [x] Recording or correcting Spend on the page updates the figures without a manual reload
- [x] The Lookback Window is displayed next to the attributed figures

## Comments

Implemented 2026-09-04.

`CampaignPerformancePanel` reads `attributedRevenueQueryOptions(period, touch)`
and selects the open Campaign's line from the returned report. Spend, ROAS,
Contribution Margin, cost coverage, the Spend day range and the Lookback Window
are therefore the exact fields behind the full report table; the detail page has
no second arithmetic path. An archived Campaign that is absent from the report
because it has neither Spend nor attributed sales gets an explicit no-activity
state rather than locally invented zeroes.

The detail card has one period state shared by the panel and its Spend rows, so
changing the period moves both together. Period and touch controls were extracted
into `campaign-performance-controls.tsx` and the report page now uses those same
controls as the detail panel, with the same `30d` and Last Touch defaults. The
panel also carries the selected touch explanation and the report's active
Lookback Window beside the figures.

The display follows the report's null semantics directly: null ROAS is `—`; a
null Contribution Margin is `No cost data`; numeric margins retain their sign,
with losses shown destructively; and every reported margin carries its coverage
or the spend-only/no-sales explanation. Currency formatting stays at the UI edge
and ROAS remains a ratio.

Spend create, range create, edit and delete already invalidate the
`["campaigns", "revenue"]` query prefix. Because the detail panel now consumes
that same query, an active panel refetches after every successful correction and
updates without a reload, while the Spend rows refetch through their existing
detail query invalidation.

Verified with the frontend production build (including `tsc --noEmit`), a
standalone TypeScript check, `git diff --check`, and Prettier checks for the new
components and the refactored report page. The existing Spend card keeps its
pre-existing four-space/long-line formatting. The UI was not exercised in a
browser in this session.
