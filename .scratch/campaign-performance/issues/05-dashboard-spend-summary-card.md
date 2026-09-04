# 05: Dashboard Spend summary card

**What to build:** The merchant opens the dashboard and sees, without navigating
anywhere, what they spent this period, what came back, and the blended ROAS
across the whole account — with the Unattributed share beside it so the ratio is
not read as more complete than it is. The card links through to the full report,
so a bad number is one click from its explanation.

The dashboard module is deliberately **not** modified. The standing rule in this
codebase is that a report module never depends on another report module —
analytics owns its own period helper rather than importing the dashboard's, and
marketing owns its own rather than importing analytics'. Marketing exposes a
summary read and the dashboard *page* composes the card from a second request.
The coupling lives in the frontend, where it is cheap.

That second request also has to be able to fail. One report must never take down
the page the merchant opens first.

**Blocked by:** 03 (Spend and ROAS on the performance report).

**Status:** ready-for-agent

- [ ] A marketing summary endpoint returns, for a period: total Spend, total attributed revenue, blended ROAS, the Unattributed share, and the active Lookback Window
- [ ] It reuses the same period helper and the same read the report is computed from, so the card and the report can never disagree
- [ ] It requires `campaigns.read`
- [ ] The dashboard page renders the card from that endpoint as an independent request; a failure degrades to a hidden or errored card and the rest of the dashboard still renders
- [ ] With no Spend recorded anywhere the card shows an empty state inviting the merchant to record some, not a zero
- [ ] The Unattributed share and the Lookback Window are shown on the card
- [ ] The card links through to the performance report
- [ ] No changes to the dashboard backend module
- [ ] End-to-end coverage: the summary figures for a period match what the report returns for the same period
