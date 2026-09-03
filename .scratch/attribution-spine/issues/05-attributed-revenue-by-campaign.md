# 05: Attributed revenue by Campaign

**What to build:** The merchant can finally answer the question this whole feature exists for — which Campaign produced revenue.

A report shows, for a chosen period, the revenue and Order count attributed to each Campaign, with Unattributed as its own visible line so the merchant can judge how much of the total the attributed figures cover. A toggle switches between First Touch and Last Touch. The active Lookback Window is shown on screen, because it is why these numbers differ from what an ad platform reports.

Orders are resolved to Campaigns at read time by running the matching rules, per the confirmed decision recorded in ADR-0001 and ADR-0002. This is what lets a Campaign created after its ads already ran still claim its history, and lets a corrected matching rule repair past reports rather than only affecting future Orders. Touches older than the Lookback Window do not qualify. Bot traffic is excluded, matching the exclusion already applied across every existing event query. Attributed revenue counts the same Order statuses the existing sales reports treat as realized revenue, so the figures reconcile.

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] The report lists revenue and Order count per Campaign for a selected period
- [ ] Unattributed revenue appears as its own line and is never spread across Campaigns
- [ ] Switching between First Touch and Last Touch changes the attribution without any data migration
- [ ] The active Lookback Window is displayed alongside the figures
- [ ] A Campaign created after its Orders were placed claims those Orders on the next read
- [ ] Adding a matching rule repairs historical figures rather than only affecting new Orders
- [ ] A Touch older than the Lookback Window does not receive credit
- [ ] Bot traffic never appears to have driven a sale
- [ ] Totals reconcile with the existing sales reporting for the same period
- [ ] Revenue is returned in the smallest currency unit and is not formatted server-side
