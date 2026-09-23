# 02: Campaigns and Ads keyed by the platform, credited by the latest ad click

**What to build:** The new spine. A Campaign stops being our own record with a
tag and becomes one campaign on an ad platform, identified by the platform's own
campaign id; an Ad likewise. An Order finds them by the ids the platform wrote
into the click, so nothing depends on a merchant typing a tag correctly, and a
rename can never break reporting.

Credit goes to the **latest ad click**: the Order's last touch if it names a
Campaign, otherwise its first touch if it does. An untagged visit after an ad
click — a search for the store's name, a bookmark — must not cancel the ad's
credit. This rule is written once and every report reads it from there.

Nothing syncs yet and nothing can be created yet, so this ticket is proved
against seeded rows. The per-Ad daily figures table arrives here, empty, so that
the report has its shape before ticket 07 fills it.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] A Campaign carries the platform's campaign id, unique per Store, its
      platform, its status as the platform reports it, its schedule and a cover
- [x] An Ad carries the platform's ad id, unique per Store, its campaign, its
      format, its status and its creative
- [x] Both carry a flag recording whether the platform's own link tags are
      present on the Ad, defaulting to absent
- [x] Campaign Tags, Ad Tags, matching rules, the rule matcher, the value
      normalizer and the rule controllers are deleted
- [x] The campaign platform vocabulary loses every non-paid value; only ad
      platforms remain
- [x] The merchant-owned `archived` status and the archive/unarchive paths are
      gone from Campaign and Ad; status comes from the platform
- [x] A table holds spend, impressions and clicks per Ad per day, spend in minor
      units, unique on the Ad and the day
- [x] An Order whose last touch carries a campaign id and an ad id credits that
      Campaign and that Ad
- [x] An Order whose last touch names no Campaign but whose first touch does
      credits the Campaign named by the first touch
- [x] An Order whose touches name no Campaign at all is Unattributed and is
      still counted in the store's totals
- [x] An Order that names a Campaign but none of its Ads counts toward the
      Campaign and is reported on its own line, never spread across the Ads
- [x] Ad-level revenue and order counts sum exactly to their Campaign's
- [x] The credit rule exists in exactly one place and is unit-tested directly,
      including both touches naming different Campaigns
- [x] Reading a Campaign or its figures from another Organization is impossible

## Comments

Done. The backend build, `tsc`, `npm test` (171 unit specs) and the frontend
build are green. `npm run test:e2e` has 109 passing and one failure, the same
`inline-edit.e2e-spec.ts` assertion ticket 01 recorded. `npm run lint` reports
only the same 7 `unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`. Neither touches marketing.

The credit rule is `creditFor` in `marketing/utils/attributed-revenue.util.ts`.
"Names a Campaign" means the touch's `utm_campaign` is exactly the platform id
of one of this Store's Campaigns, within the lookback window. So a newsletter
tag or an organic visit after an ad click falls back to the first touch, just as
an empty last touch does. The Ad is read from the same touch, and only from that
Campaign's own Ads. The first/last-touch toggle is gone from the report and the
UI.

Judgement calls not on the checklist:

**The Campaign platform reuses the `ad_platform` enum** instead of keeping its
own `campaign_platform`. "Only ad platforms remain" then holds by construction,
and a Campaign can never name a platform a Store cannot connect.

**Campaigns and Ads are read-only here.** Create, rename, archive, rules and
creative upload endpoints are removed, along with their admin UI (the new-campaign
page, rules card, archive button and ads editor). Tickets 11 and 12 bring create
and edit back through the platform. Upload goes too, because a creative is now
the platform's.

**The platform mirror is gone.** `PlatformMirrorService` wrote `platform_state`
and `placement` beside a merchant-owned status that no longer exists. The sync
still reads the tree, so the window, backfill and failure specs still apply,
but it writes nothing until ticket 07. `SyncOutcome.platformStateWritten` went
with it.

**The report already carries the daily figures.** Spend, impressions and clicks
are summed per Ad from `ad_daily_figures` over the period's days in the Store's
timezone. A Campaign's figures are its Ads' figures summed. The table is empty,
so they all read 0 until ticket 07 fills it. The unassigned line has revenue and
orders only, because spend always belongs to an Ad.

**The admin pages are a stopgap.** The list reads the report and shows "Not
tracked" instead of $0 when `hasLinkTags` is false. It also shows "Not linked to
an ad" only when there is any. The detail page is a read-only campaign card plus
its ads. Tickets 08 and 09 replace both.

`admin-campaigns.e2e-spec.ts` and `ad-revenue.e2e-spec.ts` covered only rules,
tags and archiving, so they are deleted. `campaign-revenue.e2e-spec.ts` is
rewritten against seeded rows.

