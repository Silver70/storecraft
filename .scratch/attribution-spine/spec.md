# Attribution Spine

Status: ready-for-agent

Stage 1 of the product roadmap. Respects ADR-0001 (attribution snapshot on Order)
and ADR-0002 (Campaign as a first-class entity).

## Problem Statement

A merchant running a Store spends real money boosting posts and running ads, and
has no way to find out which of that spend produced revenue.

The admin dashboard already reports traffic sources, channels, devices, and a
full funnel, and separately reports revenue, top products, margin, and refunds.
But these are two disconnected halves. Nothing in the system links the Visitor
who arrived from an Instagram ad to the Order they placed twenty minutes later.
Traffic is counted from the event log; revenue is counted from orders; the two
are never joined. Asking "which Campaign drove the most revenue" is not a
missing report — it is unanswerable, because the data required to answer it is
never captured.

This is urgent in a way most missing features are not: **attribution is not
retroactive.** Every Order placed before this exists is permanently untraceable.
A merchant who spends on ads for a month before this ships has bought a month of
revenue they can never attribute, and no later feature can recover it.

## Solution

Every Order carries, as an immutable snapshot taken at checkout, the evidence of
where its Visitor came from: the First Touch and Last Touch UTM tuples, the
referrer, and the landing path.

Separately, the merchant creates Campaigns in the admin — one per thing they
spend money on. Each Campaign owns matching rules that map incoming UTM tuples
onto it, and the admin generates canonical tagged URLs from the Campaign so
matching is exact by construction rather than dependent on typing a UTM string
correctly into an ad platform.

Reports resolve Orders to Campaigns at read time by running those matching
rules, so a Campaign created after the fact still claims its history, and fixing
a bad rule repairs past reports instead of leaving them permanently wrong.

The merchant can then see attributed revenue per Campaign. Turning that into
ROAS and Contribution Margin by entering Spend is the next stage of work and is
not part of this spec — but after this ships, every Order placed is one that a
future report can attribute.

## User Stories

### Capturing attribution

1. As a merchant, I want every Order to record which Campaign brought the Visitor, so that I can tell paid acquisition apart from organic.
2. As a merchant, I want attribution captured automatically when a Visitor arrives with UTM tags, so that I do not have to configure anything per-ad for it to work.
3. As a merchant, I want attribution recorded even when a Visitor takes days to buy, so that considered purchases like an air conditioner are not all reported as Direct.
4. As a merchant, I want both the First Touch and the Last Touch stored on every Order, so that I can see whether an ad discovered the Customer or closed them.
5. As a merchant, I want attribution frozen at the moment of purchase, so that a Customer returning later through a different ad does not rewrite the history of an Order already placed.
6. As a merchant, I want the referrer and landing path stored alongside the UTM tuple, so that I can attribute traffic that arrived untagged.
7. As a merchant, I want Orders with no qualifying Touch reported as Unattributed in their own bucket, so that unattributable revenue is never silently spread across Campaigns and made to flatter them.
8. As a merchant, I want a Lookback Window applied when deciding whether a Touch counts, so that a visit from six months ago does not claim credit for today's Order.
9. As a merchant, I want the Lookback Window shown next to every attributed figure, so that I understand why my numbers differ from what an ad platform reports.
10. As a merchant, I want bot traffic excluded from attribution, so that crawler visits never appear to have driven a sale.
11. As a merchant, I want attribution to work for guest checkout as well as for logged-in Customers, so that coverage does not depend on account creation.

### Managing Campaigns

12. As a merchant, I want to create a Campaign with a name and a platform, so that I have something to attach performance and later Spend to.
13. As a merchant, I want to edit a Campaign after creating it, so that a rename or a correction does not require starting over.
14. As a merchant, I want to archive a Campaign that has finished, so that my active list stays short without losing its history.
15. As a merchant, I want to record a Campaign's id on the ad platform, so that this Campaign can later be reconciled with a platform integration.
16. As a merchant, I want a Campaign to match several UTM variants, so that the same push tagged inconsistently is still reported as one Campaign.
17. As a merchant, I want UTM matching to ignore case and to treat hyphens and underscores as equivalent, so that `summer_sale` and `Summer-Sale` do not silently become two Campaigns and split my revenue in half.
18. As a merchant, I want to add a matching rule after Orders have already arrived, so that fixing a tagging mistake repairs my historical reports rather than only affecting future Orders.
19. As a merchant, I want to create a Campaign after its ads have already run, so that forgetting to set it up first does not permanently lose that revenue.
20. As a merchant, I want matching to be deterministic when two rules could both apply, so that the same Order always reports against the same Campaign.
21. As a merchant, I want to see which Campaign a given Order was attributed to, so that I can sanity-check the system against an order I recognise.
22. As a merchant, I want to preview which existing Orders a new matching rule would claim before I save it, so that I can tell a good rule from an over-broad one.

### Tagging links

23. As a merchant, I want the admin to generate a tagged URL for a Campaign, so that I can paste it into an ad platform without composing UTM parameters by hand.
24. As a merchant, I want the generated URL to use a canonical Campaign tag, so that matching is exact by construction and typos are impossible.
25. As a merchant, I want to generate several tagged URLs for one Campaign differing by source or medium, so that I can run the same push on more than one platform and still see it as one Campaign.
26. As a merchant, I want to copy a generated URL in one click, so that moving it into an ad platform is not error-prone.
27. As a merchant, I want to generate a tagged URL pointing at any page of my Store, so that I can send an ad straight to the product it advertises.
28. As a merchant, I want links I tagged by hand before creating the Campaign to still be claimable by a rule, so that the generator is a convenience rather than a precondition.

### Seeing the result

29. As a merchant, I want to see revenue attributed to each Campaign for a period, so that I can tell which pushes are actually producing sales.
30. As a merchant, I want to see the Order count alongside revenue per Campaign, so that I can tell one large Order apart from steady demand.
31. As a merchant, I want to switch a report between First Touch and Last Touch, so that I can see both discovery and closing performance without rebuilding anything.
32. As a merchant, I want Unattributed revenue shown as its own line, so that I can judge how much of my total the attributed figures actually cover.
33. As a merchant, I want attributed revenue to count the same Order statuses the rest of my analytics counts, so that this figure reconciles with my sales reports.

### Storefront and integrators

34. As a Visitor, I want attribution captured without anything blocking the page, so that browsing and adding to cart never feel slower.
35. As a Visitor, I want no personal data collected for attribution, so that my privacy is respected while the merchant still learns which ad worked.
36. As a developer forking the Starter Storefront, I want attribution to work out of the box, so that I get campaign reporting without implementing anything.
37. As a developer building my own storefront, I want a documented field on cart creation for passing attribution, so that I can integrate deliberately.
38. As a developer, I want attribution to be optional on cart creation, so that omitting it degrades reporting rather than breaking checkout.
39. As a developer, I want the system to fall back to correlating attribution from tracked events when I do not pass it explicitly, so that I get partial coverage before I have integrated fully.
40. As a merchant, I want to know whether an Order's attribution was declared by the storefront or inferred from events, so that I can judge how much to trust it.
41. As a merchant, I want attribution to survive the analytics retention purge, so that campaign history older than the raw event window is not lost.

### Safety

42. As a merchant, I want attribution scoped to my Organization and Store, so that no other tenant's traffic can ever be credited to my Campaigns or mine to theirs.
43. As a merchant, I want checkout to succeed even if attribution cannot be resolved, so that a reporting concern never costs me a sale.
44. As a merchant, I want a Campaign to be deletable only in a way that does not destroy the Orders it explains, so that cleaning up my Campaign list cannot corrupt revenue history.

## Implementation Decisions

### Scope boundary

This spec delivers the spine and enough reporting to prove it works. Spend
entry, ROAS, Contribution Margin, the Marketing dashboard, and the dashboard
summary card are the next stage and are out of scope here.

### Modules

- A new backend **marketing** module owns Campaigns, matching rules, canonical
  tag generation, and attributed-revenue reads. It is a standalone feature
  module in the same shape as the existing analytics module, which was likewise
  extracted so it could grow independently.
- The **cart** module gains attribution capture on cart creation and attribution
  copy-forward at checkout.
- The **analytics** module is read from — for the session-correlation fallback —
  but its existing endpoints and rollups are unchanged.
- The **admin frontend** gains a Campaigns feature area following the existing
  thin-route-plus-feature-folder convention. It is placed as a new top-level
  Marketing entry in the sidebar rather than an eighth tab on the Analytics
  page, because Campaigns are managed objects with CRUD, like Discounts, not
  read-only reporting.
- The **Starter Storefront** gains attribution capture and tracking-script
  wiring, serving as the reference implementation of the contract.

### Schema

A new `campaigns` table, tenant-scoped with `organization_id` as its second
column per the project-wide rule, also scoped by `store_id`. Fields: name, a
canonical tag slug unique per Store, platform, optional external ad-platform id,
status (active/archived), timestamps.

A new `campaign_matching_rules` table, tenant-scoped, referencing a Campaign.
Each rule targets one attribution field (utm_campaign, utm_source, utm_medium,
or referrer host), carries an operator (`equals` or `starts_with`), and a
comparison value. A Campaign may have many rules.

`carts` gains an attribution column group: first-touch and last-touch UTM
source/medium/campaign/content, referrer, landing path, `visitor_id`, the
timestamp of each Touch, and an attribution source marker distinguishing
`declared` (passed by the storefront) from `correlated` (inferred from events)
from `none`.

`orders` gains the identical column group. Values are copied from the Cart at
checkout and are never updated afterward.

Deliberately **no `campaign_id` column on orders.** Per ADR-0001 the raw UTM
tuple is the immutable fact; per the confirmed read-time resolution decision the
Campaign is an interpretation resolved by matching rules on every read. A
denormalized resolved-campaign cache column may be added later purely as a
performance optimization, and would be rebuildable from the raw tuple.

### Matching semantics

Comparison is performed on a **normalized** form of both the incoming value and
the rule value: trimmed, lowercased, with hyphens, underscores, and whitespace
collapsed to a single canonical separator. This is what makes `summer_sale`,
`Summer-Sale`, and `summer sale` one Campaign without the merchant writing three
rules, and it is the single highest-value decision in this spec.

When several rules match one Order, resolution is deterministic: a rule on
utm_campaign outranks one on utm_source or utm_medium, which outrank one on
referrer host; `equals` outranks `starts_with`; remaining ties break by the
Campaign's creation time, oldest first.

An Order matching no rule is Unattributed. Unattributed is always its own
reported bucket and is never redistributed across Campaigns.

### Touch semantics

**First Touch** is the earliest non-direct Touch within the Lookback Window
preceding the Order; **Last Touch** is the latest. Both are stored on every
Order and neither is privileged in the data model — the report chooses which to
display.

On the Cart, first-touch fields are write-once: once set they are never
overwritten. Last-touch fields are updated whenever a new non-direct Touch
arrives before the Cart converts. At checkout both groups are copied to the
Order and frozen.

The Lookback Window defaults to 30 days and is configurable by environment
variable. It is returned by any endpoint reporting attributed figures so the UI
can display it. Touches older than the window do not qualify.

Traffic with a bot device classification is excluded from attribution, matching
the exclusion already applied across every existing event query.

### API contracts

The storefront cart-creation mutation accepts an optional attribution object:
first-touch and last-touch UTM fields, referrer, landing path, and visitor id.
It is optional — omitting it degrades reporting and never fails the mutation.
Per ADR-0001 this makes attribution part of the public API contract, so its
shape is a breaking change for integrators and is versioned deliberately.

When a Cart reaches checkout carrying no declared attribution but carrying a
session id, the system attempts to resolve First and Last Touch by querying the
event log for that session within the Lookback Window, and marks the resulting
attribution as `correlated`. Declared attribution always wins over correlated;
correlation is a backstop for integrators who have not implemented pass-through,
never the primary source.

Attribution resolution never blocks checkout. Any failure is logged and the
Order is created with attribution source `none`.

New admin endpoints under the existing admin REST surface, guarded by the same
role-based permissions as other admin reads and writes: Campaign list, create,
update, archive; matching-rule create and delete; a rule-preview endpoint
returning which existing Orders a candidate rule would claim; canonical tagged
URL generation; and an attributed-revenue-by-Campaign read that accepts a period
and a First/Last Touch selector and returns per-Campaign revenue and Order
counts plus the Unattributed bucket and the active Lookback Window.

Attributed revenue counts the same Order statuses the existing analytics
consider realized revenue, so the figures reconcile with the sales reports.

### Tag generation

Each Campaign has a canonical tag slug, derived from its name at creation and
unique per Store. The generator composes a URL from a merchant-chosen
destination path on the Store plus utm_source, utm_medium, and the canonical
utm_campaign tag. A Campaign is created with an implicit exact-match rule on its
own canonical tag, so generated links always match without the merchant
authoring a rule.

### Storefront

The Starter Storefront embeds the existing tracking script and reads UTM
parameters and referrer on landing, persisting first-touch values for the
Lookback Window duration and updating last-touch on each new attributed arrival.
It passes both to cart creation. This is the reference implementation of the
contract and is where the contract's ergonomics are proven before integrators
meet it.

### Multi-tenancy and money

Campaigns, rules, and all attribution columns are tenant-scoped through the
existing tenant-scoped repository base, with row-level security as the second
line of defence. All revenue figures remain integers in the smallest currency
unit and are never formatted server-side.

## Testing Decisions

A good test here asserts externally observable behavior — that money ends up
attributed to the right Campaign — and never asserts on internal structure such
as which method was called, what a repository received, or how a query is
composed. Tests that assert an attribution function was *invoked* are explicitly
not wanted: the risk in this feature is that a stamp fails to persist or fails
to join, which a mock cannot detect and which would give false confidence
exactly where failure is silent.

Two seams, agreed with the developer.

**Seam 1 — the storefront GraphQL API through to the admin attributed-revenue
read, running real services against a local Postgres database.** This is the
highest available seam and the only one that proves the end-to-end claim. The
flow: create a Cart carrying attribution, add an item, check out, assert the
Order carries the expected First Touch and Last Touch; then read
attributed revenue by Campaign and assert the revenue landed on the right
Campaign. Cases to cover: a declared-attribution Order; an Order with no UTM
landing in Unattributed; a Campaign created *after* its Orders still claiming
them; a matching rule added after the fact repairing history; a Touch older than
the Lookback Window not qualifying; correlated fallback when attribution is
omitted but a session id is present; and an assertion that attribution never
crosses an Organization boundary.

**Seam 2 — the UTM-to-Campaign matching function, as a pure unit.** Inputs are
an attribution tuple and a set of rules; output is a Campaign or Unattributed.
No database and no framework. Cases: hyphen and underscore variants resolving to
one Campaign; case differences; leading and trailing whitespace; two rules
matching one tuple resolving deterministically by the documented precedence; no
rule matching; and an empty rule set. This seam exists specifically because
matching is the one part of the feature that fails silently — a mis-match does
not throw, it makes a Campaign look unprofitable forever — and driving every
case through a full checkout would be slow with indirect assertions.

Deliberately not used: repository-level tests, which would exercise the ORM
rather than behavior; mocked-repository service specs in the style of the
existing order and pricing specs, for the false-confidence reason above; and any
frontend or component tests, per the agreed position that the testing floor
rises only where blast radius is money or tenancy.

Prior art: the backend already has an end-to-end Jest configuration and a stub
application spec that this seam builds on rather than replacing, and the
existing unit specs for the order service, pricing engine, price resolver,
inventory service, and tenant-scoped repository establish the house style for
Seam 2. The analytics work also established an informal habit of running real
services against seeded database rows and cleaning up afterward; Seam 1
formalizes that habit into committed tests. Tests run against local Postgres and
must clean up the rows they create.

## Out of Scope

- **Spend, ROAS, and Contribution Margin.** Entering daily Spend per Campaign and
  computing return is the next stage. This spec captures and attributes revenue;
  it does not divide it by cost.
- **The Marketing dashboard and the dashboard summary card.** This spec ships
  Campaign management plus a minimal attributed-revenue read, not the full
  performance UI.
- **Ad-platform integrations.** No Meta, Google, or TikTok API. Spend will be
  entered manually. Platform sync waits until a paying user asks, because both
  Meta and Google require an application and review process and become a
  permanent maintenance surface.
- **Transactional email and the deploy path.** Both are Stage 1 siblings but
  share no code or contract with this work and belong in their own specs.
- **The CMS.** Content Slots and Inline Editing are a later stage entirely.
- **Storefront performance work.** Optimistic add-to-cart, removing the extra
  network hop, and the theme configuration layer are a separate stage. Only the
  attribution capture and tracking-script wiring land here.
- **Cross-device identity resolution.** Attribution follows the anonymous
  `visitor_id`; stitching a Visitor across devices via a logged-in Customer is a
  later refinement.
- **Multi-touch or fractional attribution models.** First Touch and Last Touch
  only; no linear, time-decay, or position-based credit splitting.
- **Backfilling historical Orders.** Orders placed before this ships have no
  attribution evidence and cannot be recovered. This is the reason the work is
  sequenced where it is.

## Further Notes

**The Lookback Window will need revisiting for high-ticket goods.** A 30-day
default is a reasonable industry starting point, but someone researching a
several-thousand-dollar air conditioner may take longer than that, which would
report genuine campaign-driven sales as Unattributed. This is a reason to look
at real First-Touch-to-Order intervals before hardening the default, and a
reason the window is configurable rather than constant.

**These numbers will not match an ad platform's, and that is expected.** Meta
defaults to a 7-day click window, so a 30-day lookback will credit more
conversions than Meta reports. Displaying the active window next to every
attributed figure is what keeps that difference legible instead of alarming.

**Read-time resolution is a deliberate trade of read cost for correctness.**
Every report runs matching as a join rather than reading a precomputed column.
At the volumes in question this is immaterial. If it ever becomes slow, a
denormalized resolved-campaign column can be added as a rebuildable cache — a
reversible optimization, where freezing an immutable foreign key at write time
would not be.

**This is consistent with an existing decision in the codebase.** Category sales
already join the live category graph rather than snapshotting a category onto
line items, with the accepted consequence that recategorizing a product reshapes
history. Campaign attribution is the same shape of decision resolved the same
way.

**Attribution deliberately outlives the raw event log.** Raw events are purged
on a retention schedule, but attribution lives on the Order as columns, so
campaign history survives the purge. This is the central reason ADR-0001 chose
stamping over querying, and any future change that reintroduces a read-time
dependency on raw events for historical attribution would undo it.

**Environment reconciliation is a prerequisite for the tests.** Local Postgres
is running, but the backend environment file still points at the hosted
database. Seam 1 must run against local Postgres, and pointing the test
configuration at a shared database risks a cleanup step truncating real rows.
