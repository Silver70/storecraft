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

**Status:** ready-for-agent

- [ ] The Campaign detail page shows that Campaign's Spend, ROAS, and Contribution Margin with coverage for the selected period
- [ ] The figures are derived from the same read that produces the report, not recomputed
- [ ] The period and touch selection behave the same as on the report
- [ ] The null states are respected here too: `—` for a ROAS with no Spend, "no cost data" for a margin with no coverage
- [ ] Recording or correcting Spend on the page updates the figures without a manual reload
- [ ] The Lookback Window is displayed next to the attributed figures
