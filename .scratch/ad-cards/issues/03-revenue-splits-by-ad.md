# 03: Revenue splits by Ad

**What to build:** A merchant sees which of the four creatives under one push
actually sold something. An Order arriving with an Ad Tag in `utm_content`
resolves onto that Ad, and the report gains a line per Ad beneath each Campaign,
with its own attributed revenue, purchases, Spend, ROAS and Contribution Margin.

An Order that matches a Campaign and none of its Ads is Unassigned within that
Campaign, and is shown as such — never spread across whichever Ads happen to
exist.

Because `utm_content` has been stamped on both Touches of every Order since
ADR-0001, this applies to history the day it ships. There is no window of
unmeasurable spend to race.

**Blocked by:** 02 (Spend against an Ad).

**Status:** resolved

- [x] Attribution resolves in two passes per ADR-0004. The existing Campaign
      matcher runs unchanged and picks the Campaign; a second matcher then picks
      an Ad from `utm_content`, built over that Campaign's own Ads alone
- [x] **An Ad can never claim a tuple whose `utm_campaign` resolves to a
      different Campaign.** This is the property ADR-0004 was written for, and it
      fails without throwing, so it is exercised exhaustively as a unit rather
      than inferred from the far end of a checkout
- [x] Two Campaigns each owning an Ad tagged `video-a` resolve independently and
      correctly
- [x] Both matchers stay pure: no database, no framework, no clock
- [x] A `utm_content` that normalizes to nothing is Unassigned, not a match —
      absence of evidence is not a match, on the same principle the Campaign
      matcher already applies
- [x] Both sides of the Ad comparison are normalized, so `Video_A` and `video-a`
      are one Ad
- [x] An Ad created today claims the Orders its links already produced, because
      resolution happens at read time
- [x] The report returns a per-Ad breakdown beneath each Campaign line, plus an
      Unassigned line per Campaign
- [x] Unassigned is always its own visible bucket and is never redistributed
      across the Ads that exist, on the same principle that keeps Unattributed
      visible at the Store level. It is a distinct outcome from Unattributed and
      the two are never folded together
- [x] Per-Ad figures come from the same read the Campaign report is computed
      from — one calculation and one definition of a period, following the
      precedent the Campaign performance panel already set
- [x] Per-Ad ROAS and Contribution Margin follow the existing null semantics
      exactly: no ROAS without Spend rather than zero, and no margin without cost
      coverage rather than a fiction
- [x] Switching between First Touch and Last Touch splits by Ad correctly under
      both, since both Touches carry `utm_content`
- [x] A Campaign's own totals are unchanged by the split: its Ads' figures plus
      its Unassigned figure reconcile to the Campaign line
- [x] Money stays in minor units and is never formatted server-side; ROAS stays a
      ratio and never passes through the money formatter
- [x] A merchant sees the per-Ad split on the Campaign detail page
- [x] Proven at the full-length seam: a sale arrives through the public
      storefront API carrying `utm_content` alongside its other tags, and the
      merchant reads the money back through the admin API resolved onto the Ad
      that earned it, against figures worked out by hand rather than recomputed
      by the test
- [x] The storefront pass-through of `utm_content` is verified end to end rather
      than assumed, and per ADR-0001 resolving it can still never fail a checkout

## Comments

Implemented 2026-09-09.

**Two matchers, two reads, and neither can see the other's rules.** The Campaign
matcher is untouched. Ad resolution is a new pure module,
`marketing/utils/ad-matching.util.ts`, whose matcher takes the winning Campaign
as its *first parameter* — `(campaignId, tuple) => adId | null` — and looks up a
candidate list keyed by Campaign. An Ad of another Campaign is not scanned, not
ranked and not loaded, so ADR-0004's property holds structurally rather than by
a check that could be removed. The same partition exists one layer down in SQL:
`CampaignRepository.findMatchableRules` filters `ad_id IS NULL` and the new
`AdRepository.findMatchableAdRules` filters `ad_id IS NOT NULL`, so between them
neither matcher can ever be handed the other's rules. `AD_MATCH_FIELDS` is
`['utm_content']` and every rule on another field is dropped before grouping,
the mirror of `CAMPAIGN_MATCH_FIELDS` dropping `utm_content`.

`ad-matching.util.spec.ts` exercises the property exhaustively rather than by
example: every campaign × every tag in the fixture, asserting that any non-null
answer belongs to the campaign that was asked about. Two Campaigns each owning a
`video-a` are covered from both directions, including the case where one of them
has no Ads at all and must come back Unassigned rather than borrow the other's.

**One loop, one period, one arithmetic.** `tallyAttributedRevenue` now takes the
Ad matcher too and fills `adsByCampaign` in the same pass over the same rows: an
Order no Campaign claimed is never offered to an Ad. In the service every line at
every grain goes through one `figuresFor(bucket, goods, spend)`, so ROAS and
Contribution Margin mean exactly one thing on the report and the null semantics
are identical wherever they are read — no ROAS without Spend, no margin without
cost coverage. `CampaignRevenueLine`, `AdRevenueLine` and the Unassigned line all
extend one `PerformanceFigures`.

**Unassigned is a full line, and that is what makes the split reconcile.** It
carries revenue, orders, the goods basis, and the Spend recorded against the
Campaign without naming an Ad — issue 02's unsplit grain. Every Ad's figures plus
the Unassigned figure therefore add back up to the Campaign's own on every basis,
which the e2e asserts by summing the lines the API actually returned. It is
deliberately unlike Unattributed, which still carries no goods basis: nobody
spent against a bucket with no Campaign, but money really was spent against this
one. The two are never folded together, and an e2e case puts one Order in each to
prove it.

`CampaignSpendRepository.sumByCampaign` became `sumByGrain` — one grouped query
returning `byCampaign`, `byAd` and `unsplitByCampaign` together. Three reads would
be three chances for the day range or the `bigint` cast to drift, and the drift
would surface as a Campaign disagreeing with the sum of its own lines.

**The bug the seam caught.** `utm_content` was stamped on both Touches since
ADR-0001 and reached the Order columns correctly, but
`AttributionRepository.touchColumns` never selected it — so the split silently
resolved everything to Unassigned. Nothing threw; only the full-length e2e found
it. It is now selected on both Touch groups, which is also what makes the feature
retroactive: an Ad created today claims the Orders its links already produced,
asserted as a before/after read in `ad-revenue.e2e-spec.ts` with the Campaign's
own totals unchanged across it.

**On screen.** The per-Ad split renders under the Campaign detail page's
performance panel (`components/ad-breakdown.tsx`), selected off the same report
line the three figures above it come from — nothing is refetched or recomputed
for it. Unassigned is always the last row, visually distinct, with copy saying
what it is and that it is not Unattributed. A Campaign with no Ads renders
nothing at all rather than an empty table, because an Ad is a subdivision a
merchant opts into. Creating or archiving an Ad now invalidates the revenue
query as well as the ad list, since read-time resolution means the split changes
the moment an Ad exists.

**Not done here.** The full `/admin/campaigns/revenue` table still shows Campaign
lines only; the API returns the split for every line and issue 05 merges the two
pages, which is where that table gets its expandable rows.
