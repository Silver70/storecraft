# Ad Cards

Status: ready-for-agent

Stage 5 of the product roadmap — "make the marketing section legible at the
level the merchant actually thinks in". Builds on the Attribution Spine
(`.scratch/attribution-spine/`) and Campaign Performance
(`.scratch/campaign-performance/`), and respects ADR-0001 (attribution snapshot
on Order), ADR-0002 (Campaign as a first-class entity) and ADR-0004 (an Ad is
nested under its Campaign, resolved in a second pass).

This stage needs no third-party integration and no vendor. The Zernio ingest —
Reported Figures, Unlinked Ads, Platform State, Placement — is Stage 6 and is
out of scope here, though the shape of this stage is what makes it landable.

## Problem Statement

A merchant runs four creatives under one push. Our system can only see one
thing.

A Campaign today is flat: one record, one Campaign Tag, one row in a table. That
was the right model for Stage 1, where the question was "which push drove
sales". It is the wrong model for the question a merchant asks next, which is
"which of these four is working". The system has no answer, because it has no
noun for the thing being compared. Four creatives under one Campaign report as
one number, and the merchant's only workaround is to create four Campaigns and
group them by naming convention — which loses the roll-up, splits the Spend, and
makes "what did this push return" unanswerable in the other direction.

The report is also the wrong shape for the decision. It is a dense table of
figures, and a merchant recognises an ad by its picture, not by its slug. Asked
"how did the beach video do", a merchant reading this table has to remember
which of `summer-vid-a` and `summer-vid-b` was the beach one. That recall step
is where the report stops being used, and an unused report measures nothing.

Two pages compound it. `/admin/campaigns` lists managed objects;
`/admin/campaigns/revenue` reports on them. So performance lives somewhere other
than the thing it describes, with its own period selector, and a merchant
comparing two Campaigns has to hold figures in their head across a navigation.

There is one saving grace, and it is the reason this stage is cheap. Since
ADR-0001 the storefront has stamped `utm_content` onto both Touches of every
Cart and Order. The evidence for per-Ad reporting has been accumulating this
whole time. What is missing is a noun to attach it to and a matcher that reads
it — so unlike Stage 1, this feature is retroactive, and there is no window of
unmeasurable spend to race.

## Solution

Give the merchant the noun. An **Ad** is one creative running under a Campaign:
it owns its own Ad Tag, its own flight dates, its own creative, and optionally
its own Spend. A Campaign may have none — an Ad is a subdivision a merchant opts
into, never a wrapper invented around a Campaign that has one.

Attribution resolves in two passes, per ADR-0004. The existing matcher picks the
Campaign from `utm_campaign` exactly as it does today, untouched. A second pass
then picks an Ad from `utm_content`, but only among that Campaign's own Ads. An
Ad can therefore never claim a sale that belongs to a sibling Campaign, and two
Campaigns are both free to call their variants `video-a`. An Order that matches
a Campaign and none of its Ads is **Unassigned** within that Campaign — its own
visible bucket, on the same principle that already keeps Unattributed visible at
the Store level.

Then show it the way a merchant recognises it. `/admin/campaigns` and
`/admin/campaigns/revenue` merge into one page: a grid of cards, each carrying
the creative, the flight dates, the platform, the status, and the figures that
were already being computed — attributed revenue, purchases, Spend, ROAS,
Contribution Margin with its coverage. Visitors and conversion rate join them,
visually demoted and labelled, because they come from an ad-blockable stream
that the retention purge eventually deletes and they must not read as being as
solid as the order-derived figures beside them. A dense table stays available
behind a view toggle, because a card grid does not scale to forty Ads and the
bookstore will have forty Ads.

## User Stories

1. As a merchant, I want to create an Ad under a Campaign, so that I can measure
   one creative separately from the others in the same push.
2. As a merchant, I want an Ad to be optional, so that a Campaign I have not
   split still reports exactly as it does today.
3. As a merchant, I want each Ad to get a canonical Ad Tag derived from its
   name, so that I do not have to invent a tagging convention myself.
4. As a merchant, I want the Ad Tag to be unique only within its Campaign, so
   that I can call the video variant `video-a` in every Campaign I run.
5. As a merchant, I want the Ad Tag to stay fixed when I rename an Ad, so that
   links already live in an ad platform keep matching.
6. As a merchant, I want a Tagged Link generated for an Ad to carry both the
   Campaign Tag and the Ad Tag, so that a link I paste into a platform is
   attributed at both levels by construction.
7. As a merchant, I want to copy an Ad's Tagged Link in one action, so that
   moving it into an ad platform does not introduce a typo.
8. As a merchant, I want Orders to resolve onto an Ad from `utm_content`, so
   that revenue splits by creative without me recording anything by hand.
9. As a merchant, I want an Ad created today to claim the Orders its links
   already produced, so that adding structure repairs my history instead of
   starting a new one.
10. As a merchant, I want an Ad to be unable to claim a sale whose
    `utm_campaign` names a different Campaign, so that revenue never silently
    moves between Campaigns.
11. As a merchant, I want Orders that match a Campaign but none of its Ads to
    appear as Unassigned, so that a tagging mistake is visible rather than
    absorbed into whichever Ad happens to exist.
12. As a merchant, I want to see how much of a Campaign's revenue is Unassigned,
    so that I know how far to trust the per-Ad split beneath it.
13. As a merchant, I want to record Spend against an Ad, so that I can see the
    return on one creative rather than on the whole push.
14. As a merchant, I want to keep recording Spend against a Campaign without
    naming an Ad, so that I am not forced into a finer grain than I have data
    for.
15. As a merchant, I want Spend recorded before Ads existed to stay attached to
    its Campaign, so that upgrading does not invent a creative that never ran.
16. As a merchant, I want a Campaign's Spend to include Spend recorded against
    its Ads, so that the two levels never disagree about what a push cost.
17. As a merchant, I want ROAS and Contribution Margin computed for an Ad the
    same way they are for a Campaign, so that I am comparing like with like.
18. As a merchant, I want an Ad with no Spend to show no ROAS rather than zero,
    so that an untracked creative is not ranked as a failure.
19. As a merchant, I want to upload a creative image to an Ad, so that I can
    recognise it at a glance instead of decoding its slug.
20. As a merchant, I want an Ad with no creative to still look deliberate, so
    that a Campaign on a platform I cannot pull images from is not a grid of
    broken cards.
21. As a merchant, I want to set flight dates on an Ad, so that a three-day test
    is not compared naively against a month-long evergreen.
22. As a merchant, I want to see a Campaign's Ads on one page as cards, so that
    I can compare creatives the way I think about them.
23. As a merchant, I want the card to carry revenue, purchases, Spend, ROAS and
    Contribution Margin, so that I do not navigate elsewhere to judge what I am
    looking at.
24. As a merchant, I want the Lookback Window shown next to any ROAS, so that I
    know why my figure differs from the ad platform's.
25. As a merchant, I want Contribution Margin shown with its cost coverage, so
    that I can tell a real margin from one built on missing cost prices.
26. As a merchant, I want visitors and conversion rate on the card, so that I
    can tell a creative nobody clicked from one that was clicked and did not
    convert.
27. As a merchant, I want the measured-traffic figures visibly distinguished
    from the order-derived ones, so that I do not treat an ad-blockable estimate
    as a fact.
28. As a merchant, I want one page for managing and measuring Campaigns, so that
    performance lives on the thing it describes.
29. As a merchant, I want one period selector governing the whole page, so that
    two figures on screen are never from two different windows.
30. As a merchant, I want to switch between First Touch and Last Touch on this
    page, so that the choice behaves the way it already does on the report.
31. As a merchant with forty Ads, I want to switch the grid to a dense table, so
    that the page stays usable at a size cards cannot handle.
32. As a merchant, I want to sort and filter by Campaign, platform and status,
    so that I can find the push I am looking for.
33. As a merchant, I want to archive an Ad, so that a finished creative leaves
    my active view without losing the history that explains past Orders.
34. As a merchant, I want archiving a Campaign to archive its Ads, so that I do
    not have to tidy up twice.
35. As a merchant, I want restoring a Campaign to leave its Ads archived, so
    that un-archiving does not silently resurrect creatives I retired one by
    one.
36. As a merchant, I want no way to delete an Ad, so that revenue already
    reported against it cannot be silently re-bucketed.
37. As a merchant, I want an Ad that spent money and earned nothing to appear on
    the page, so that the most actionable fact in the account is not the one
    thing hidden from me.
38. As a merchant, I want a Campaign with no Ads to look unremarkable rather
    than incomplete, so that I am not nagged into a structure I do not need.
39. As a merchant on a Store with several Campaigns and Ads, I want every figure
    scoped to my Organization and Store, so that no other tenant's spend can
    reach my report.

## Implementation Decisions

### The Ad entity

A new tenant-scoped table for Ads, carrying `organization_id` as its second
column like every other tenant-scoped table, plus `store_id` and `campaign_id`.
Its fields: name, tag, status (`active` / `archived`), `archived_at`, nullable
`starts_at` / `ends_at` flight dates, a nullable creative media reference, and a
nullable `external_id` for the later reconciliation ADR-0002 anticipated.

An Ad has **no `platform` of its own** — it inherits its Campaign's. Platform
belongs at the Campaign because funding is per ad account, and ADR-0002 already
put it there. `Placement` (the "Instagram Ad" badge) is a Stage 6 column filled
only by a sync; do not add it here.

The unique constraint is on `(campaign_id, tag)`, not `(store_id, tag)` — that
is what buys story 4, and it is only safe because of the nested resolution
below. The database is the authority on it, not the read that preceded the
insert, matching how `campaigns_store_tag_unique` is already used.

There is deliberately **no delete**, for the reason ADR-0002 gives for
Campaigns: attribution resolves from rules at read time, so removing a row would
silently re-bucket revenue already reported.

### Tags and matching rules

Every Ad is created already owning a canonical Matching Rule on its own Ad Tag,
on a new `utm_content` rule field, exactly as a Campaign is created owning a
rule on its Campaign Tag. That canonical rule is not merchant-deletable.

Tag derivation reuses the existing Campaign Tag derivation so both sides of a
comparison normalize identically. Uniqueness is resolved within the Campaign.

### Nested resolution (ADR-0004)

**Do not add `utm_content` to the existing `FIELD_RANK`.** The current matcher
is first-match-wins over a single flat total order; adding a field there lets an
Ad rule outrank a Campaign rule and claim a tuple belonging to another Campaign,
which fails silently and is exactly what ADR-0004 exists to prevent.

Instead: the existing Campaign matcher runs unchanged and returns the Campaign.
A second matcher is then built over that Campaign's Ads alone and resolves the
Ad from the Touch's `utm_content`. `AttributionTuple` gains a `utmContent` field
that the Campaign matcher ignores.

Both matchers stay pure — no database, no framework, no clock — for the reason
the existing file states: matching is the one part of attribution that fails
without throwing.

An unresolved Ad within a resolved Campaign is **Unassigned**, and is a distinct
outcome from Unattributed. Never fold one into the other, and never redistribute
Unassigned revenue across the Ads that exist.

### Spend

`campaign_spend` gains a **nullable** `ad_id`. Spend does not move wholesale to
the Ad: a row naming no Ad means the cost is known and its split is not.

This changes the day-uniqueness rule. Today it is `(campaign_id, day)`; it must
become a constraint that admits one Campaign-level row per day _and_ one row per
Ad per day, without letting a double-submit double a figure. Choose an
expression that keeps the upsert semantics the existing schema comment defends —
the failure it prevents (a silent doubling that halves ROAS forever and never
throws) is the reason that constraint exists.

A Campaign's Spend for a period is the sum of its own rows and its Ads' rows.
The two levels must never disagree.

**The migration invents no Ads.** Existing `campaign_spend` rows keep
`ad_id = NULL`. A synthetic "default Ad" would sit in the card grid forever
claiming to be a creative that never ran.

`currency` stays denormalized on the row, and there is still no conversion
anywhere in this feature.

### The report

`AttributedRevenueReport` gains a per-Ad breakdown under each Campaign line, and
an Unassigned line per Campaign. The figures come from the same read the
Campaign report is computed from — one calculation, one definition of a period,
per the precedent set by the Campaign detail performance panel.

Visitors and conversion rate are a **new** join, per Ad and per Campaign, from
`analytics_events` on `utm_campaign` + `utm_content` + `visitor_id`. They are
returned in a shape that marks them as measured rather than order-derived, so
the UI cannot present them identically by accident. Conversion rate is purchases
over visitors; both are absent, not zero, when the event stream has nothing.

Money stays in minor units and is never formatted server-side. ROAS stays a
ratio and never passes through the money formatter.

### Creative upload

Follow the existing product-media pattern rather than inventing one: the
`R2StorageService` already in `src/shared/storage/`, and the multipart upload
shape the admin product controller already uses for product media. Same
validation posture, same tenant scoping.

The creative is a nullable reference. Stage 6's sync fills the same column an
upload fills, so nothing about this needs revisiting when the ingest lands.

### Admin API

Ad CRUD is REST under the admin surface, protected by the admin JWT and RBAC
like every other admin route — no admin mutations in GraphQL. Ads are addressed
beneath their Campaign, because an Ad has no meaning outside one. `findById`
checks `organization_id`; never trust a UUID belongs to the current tenant.

Archiving a Campaign cascades to its Ads. Restoring a Campaign does **not**
cascade — the merchant re-activates Ads deliberately.

### Storefront

The public storefront API already accepts `utm_content` on cart creation and the
Starter Storefront already sends it. Verify the pass-through end to end rather
than assuming it; per ADR-0001 attribution is optional on the storefront API and
resolving it can never fail a checkout.

### Frontend

`/admin/campaigns` and `/admin/campaigns/revenue` merge. `/revenue` redirects
rather than 404s. One period selector and one touch selector govern the page,
reusing the extracted performance controls rather than adding a second set.

The card grid has a dense-table toggle, and the toggle choice persists across
navigations. Follow the feature-first convention: thin routes,
`src/features/campaigns/`.

The card's empty creative state is a designed state, not a broken image — it
will be the majority state for months, and permanently for email, SMS,
affiliate and influencer Campaigns.

## Testing Decisions

A good test here asserts what a merchant would read off the screen, not how the
figure was computed. Assert against numbers worked out by hand from seeded
prices rather than recomputed by the test, which is the convention
`campaign-revenue.e2e-spec.ts` already follows — a test that recomputes the
implementation's arithmetic proves only that it is self-consistent.

**No new seams.** All four already exist:

1. **`campaign-revenue.e2e-spec.ts`** — the highest seam and the primary one. A
   sale arrives through the public storefront GraphQL API carrying `utm_content`
   alongside its other tags, and the merchant reads the money back through the
   admin REST API split by Ad. Everything between is the real application
   against a local Postgres database. This is where the retroactivity claim is
   proven: an Ad created after its links already ran claims their Orders. This
   is also where Unassigned is proven to be its own visible bucket.

2. **`admin-campaigns.e2e-spec.ts`** — Ad CRUD over real HTTP with a real admin
   token and store header: creation, the canonical rule created with it, tag
   derivation and per-Campaign uniqueness, rename leaving the tag fixed, flight
   dates, creative upload, the archive cascade and the non-cascading restore,
   and the absence of a delete. Tenancy is asserted here: an Ad id from another
   Organization must not resolve.

3. **`campaign-spend.e2e-spec.ts`** — Spend recorded against an Ad and against a
   Campaign with no Ad; the day-uniqueness behaviour under a double-submit,
   which is the failure this constraint exists to prevent; and a Campaign's
   Spend summing its own rows and its Ads' rows.

4. **`campaign-matching.util.spec.ts`** — the pure matcher, exercised
   exhaustively because this decision fails without throwing. The property
   ADR-0004 was written for belongs here: an Ad rule can never claim a tuple
   whose `utm_campaign` resolves to a different Campaign. Also: two Campaigns
   each owning an Ad tagged `video-a` resolve independently and correctly; a
   `utm_content` that normalizes to nothing is Unassigned rather than a match;
   and resolution is deterministic across re-reads.

Prior art for all four is the existing file of the same name. Reuse
`AdminClient`, the admin fixture and the storefront fixture; seed an
Organization per test and delete it afterwards, letting the cascade do the rest.

**The frontend is not tested.** This holds the existing floor — coverage is
raised only where blast radius is money or tenancy — and there is no frontend
test setup in `apps/frontend` to extend. The attribution correctness that
matters is asserted at the backend seams above.

## Out of Scope

- **Everything Zernio.** Reported Figures, the Unlinked Ad review list, Platform
  State, Placement, the per-Store profile mapping and scoped keys, and the sync
  itself are all Stage 6. Their terms are already in CONTEXT.md and their
  decisions in ADR-0005; do not build against them here.
- **Period-over-period deltas** (the `↑18.4%` on the mockup). There is no
  comparison read anywhere in the codebase; adding one means a second full read
  of the report on every page load plus a decision about what a delta means when
  the prior period had no Spend. Its own ticket, later.
- **The traffic sparkline** (`+12.6%`). Needs a campaign/ad dimension on
  `analytics_daily_metrics` and a rollup change, or it dies at the retention
  purge. Its own ticket, later.
- **A third hierarchy level** (ad sets / ad groups). Rejected in ADR-0004: the
  middle level holds budget and targeting, and we do neither.
- **Creating or publishing ads to an ad platform.** Mirror-only was the decision;
  the write path is not on the roadmap.
- **Placement as a reporting dimension.** One Ad runs in several placements at
  once, which makes it a many-to-many. Not now, and not as a label either until
  a sync fills it.
- **Changing the Lookback Window**, the touch model, or anything else ADR-0001
  settled.

## Further Notes

**This stage is retroactive, which is unusual here.** Stage 1 had a real
deadline because attribution is not retroactive — spend before the spine existed
produced revenue that can never be traced. This stage has no such deadline:
`utm_content` has been stamped on every Order since ADR-0001, so the day the Ad
entity ships, history splits by Ad for free. Ship it when it is right, not when
it is fast.

**The one dependency lives outside the code.** Per-Ad Spend can eventually be
synced. Per-Ad _revenue_ cannot — only a link carrying the Ad Tag joins a
platform's ad to our Orders. If a merchant does not tag `utm_content` inside the
ad platform, the result is cost against Unassigned revenue: an Ad that looks
like it earned nothing. That is why Unassigned must be prominent rather than
tidy, and why the Tagged Link must be one click from the Ad that needs it. The
UI's job here is to make the untagged case obvious enough to fix.

**Two reliability classes on one card.** Revenue, purchases, Spend, ROAS and
Contribution Margin come from Orders. Visitors and conversion rate come from
`analytics_events`, which is ad-blockable and is deleted by the retention purge.
Presenting them in identical typography would imply they are equally solid; when
ad blockers eat a third of traffic, conversion rate reads far higher than it is
and a merchant optimises toward a fiction. The house convention already exists
for exactly this — `costCoveragePct` beside Contribution Margin, the Lookback
Window beside ROAS, Declared beside Correlated Attribution. Follow it.

**Watch the Spend uniqueness constraint.** Widening `(campaign_id, day)` to
admit Ad rows is the single most dangerous change in this spec. The existing
constraint is what makes a double-submit correct a day rather than double it,
and its schema comment names the consequence precisely: a silently halved ROAS,
forever, with nothing thrown. Get this one under test before anything else
depends on it.
