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

- [x] Spend is gone: the table, its repository and service, single-day and range
      entry, the source/provenance flag, pinning and un-pinning, and the spend
      card in the admin
- [x] The unlinked-ad queue is gone: its table, its state machine, its claim,
      dismiss, restore and unlink paths, its controller and its admin panel
- [x] Reported figures are gone: the table, the service that wrote them, and
      every place the platform's revenue, conversions or ROAS was displayed
      beside ours
- [x] The vendor adapter that was never chosen (`ayrshare.adapter.ts`) is
      deleted, not ported
- [x] Tagged-link generation is gone from the admin, for both Campaigns and Ads
- [x] The rule-preview panel is gone; rule CRUD itself stays until ticket 02
- [x] Measured traffic is gone from the marketing surface: visitors, the
      tracker-derived conversion rate, and the demoted styling that existed to
      mark them as untrustworthy
- [x] The campaigns page loses its KPI summary strip, its filter bar, its
      first/last-touch toggle and its card/table view switch
- [x] The dashboard's spend summary card and the marketing summary endpoint
      behind it are gone; the dashboard module itself is not otherwise touched
- [x] The attributed-revenue report still returns revenue and order counts per
      campaign, without spend, ROAS or margin
- [x] The attribution snapshot on Cart and Order, the touch rules, the lookback
      resolution and the realized-revenue status set are untouched
- [x] Every e2e spec that covered a deleted capability is deleted with it,
      rather than left skipped
- [x] `npm run build`, `npm run check-types`, `npm run lint`, `npm test` and
      `npm run test:e2e` are all green

## Comments

Done. `npm run build`, `npm run check-types` and `npm test` (253 unit specs) are
green. `npm run lint` and `npm run test:e2e` are back to the state they were in
before this ticket: lint reports 7 `unbound-method` errors in
`inventory.service.spec.ts` and `order.service.spec.ts`, and the e2e suite has
one failure in `inline-edit.e2e-spec.ts` (`canEditContent` was added to the
config response without updating the assertion). Both were verified against a
clean checkout of `main` and neither touches marketing; they were left alone
rather than fixed here.

Three judgement calls worth recording, none of them on the checklist:

**A placeholder is bound to `AD_PLATFORM_PROVIDER`.** Deleting
`ayrshare.adapter.ts` left the seam with nothing behind it, and the connection
service injects the token, so the module could not be constructed. The spec
pairs that deletion with adding the Zernio adapter, but this ticket pulls it
forward, so `unconfigured-ad-platform.adapter.ts` refuses every call with one
sentence until ticket 04 replaces it. It is the only code added by this ticket.

**The goods basis went with Contribution Margin.** Margin needs Spend, so it
could not survive; its only inputs were the per-order goods revenue, cost,
costed-revenue and discount sums, which nothing else read. The joins to
`order_line_items` and `product_variants` therefore came out of
`AttributionRepository`, which is now one row per order and no joins at all.
`margin.util` and `performance.util` are deleted with them.

**The sync survives, stripped.** `AdPlatformSyncService` wrote four things —
reported figures, synced spend, held unlinked ads, and the platform's own state
and placement. The first three are gone; the fourth is not on this ticket's list
and not merchant-facing bookkeeping, so the sync keeps its window, its backoff
and its `PlatformMirrorService` call and nothing else. `PlatformMirrorService`
lost `forget()`, whose only caller was the deleted unlink path.
`reported-money.util` is kept — minus `toBasisPoints`, which existed only for
reported ROAS — because it is the tested decimal-to-minor-units rule the spec
requires of the next adapter.

The one dropped e2e case worth naming is "forgets what the platform said once
the ad stops claiming it": it drove the unlinked-ad claim/unlink flow end to
end, and there is no longer a path by which an Ad stops claiming a platform ad.
