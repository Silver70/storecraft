# 01: Strip the manual marketing system

**What to build:** Nothing. This ticket only deletes, so that every ticket after
it is a smaller change against a smaller surface.

A merchant opening Campaigns afterwards still sees their campaigns and the
revenue attributed to each. What has gone is everything they were being asked to
maintain or decode: typing in spend, claiming ads, reading two sets of figures
side by side, and the controls wrapped around all of it.

Matching rules stay for now — they are still the only join between an Order and
a Campaign, and ticket 02 replaces them. Spend, ROAS and Contribution Margin
therefore disappear from the report in this ticket and return in 07, when the
platform starts reporting them. That gap is deliberate and is not to be papered
over with a temporary figure.

There is no data migration anywhere in this feature. The hosted database holds no
real campaigns, spend or reported figures, so tables are dropped rather than
altered.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Spend is gone: the table, its repository and service, single-day and range
      entry, the source/provenance flag, pinning and un-pinning, and the spend
      card in the admin
- [ ] The unlinked-ad queue is gone: its table, its state machine, its claim,
      dismiss, restore and unlink paths, its controller and its admin panel
- [ ] Reported figures are gone: the table, the service that wrote them, and
      every place the platform's revenue, conversions or ROAS was displayed
      beside ours
- [ ] The vendor adapter that was never chosen (`ayrshare.adapter.ts`) is
      deleted, not ported
- [ ] Tagged-link generation is gone from the admin, for both Campaigns and Ads
- [ ] The rule-preview panel is gone; rule CRUD itself stays until ticket 02
- [ ] Measured traffic is gone from the marketing surface: visitors, the
      tracker-derived conversion rate, and the demoted styling that existed to
      mark them as untrustworthy
- [ ] The campaigns page loses its KPI summary strip, its filter bar, its
      first/last-touch toggle and its card/table view switch
- [ ] The dashboard's spend summary card and the marketing summary endpoint
      behind it are gone; the dashboard module itself is not otherwise touched
- [ ] The attributed-revenue report still returns revenue and order counts per
      campaign, without spend, ROAS or margin
- [ ] The attribution snapshot on Cart and Order, the touch rules, the lookback
      resolution and the realized-revenue status set are untouched
- [ ] Every e2e spec that covered a deleted capability is deleted with it,
      rather than left skipped
- [ ] `npm run build`, `npm run check-types`, `npm run lint`, `npm test` and
      `npm run test:e2e` are all green
