# Commerce OS

A multi-tenant headless commerce engine. This glossary pins the terms that mean
different things in different commerce products, so that code, UI copy, and
conversation all use one word per concept.

## Tenancy & stores

**Organization**:
The tenant. The unit of billing, membership, and data isolation; every
tenant-scoped row carries its `organization_id`.
_Avoid_: Account, workspace, tenant (in user-facing copy)

**Store**:
A single storefront within an Organization, with its own currency, timezone,
and catalog namespace. One Organization may own several Stores.
_Avoid_: Shop, site, channel

**Admin User**:
A person who signs into the admin dashboard. Distinct from a Customer; they are
separate identities in separate auth stacks and never share a record.
_Avoid_: User (unqualified), operator

## People & identity

**Customer**:
A person who buys from a Store. Identified by a Store-scoped account, or created
at checkout as a guest.
_Avoid_: Client, buyer, shopper, account

**Visitor**:
An anonymous browser identified by a persistent `visitor_id` that survives across
Sessions. The unit of "returning visitor" and of cross-session uniques.
_Avoid_: User, unique, anonymous customer

**Session**:
One continuous visit by a Visitor, identified by a caller-supplied `session_id`.
The grouping key for the funnel.
_Avoid_: Visit, journey

## Marketing & attribution

**Campaign**:
A named thing an Organization spends money on to acquire traffic — a boosted
post, an ad set, an email push. A first-class record with its own Spend and,
where applicable, an external ad-platform id. Deliberately _not_ the same object
as a UTM string: one Campaign absorbs many UTM variants via its matching rules.
The parent of its Ads: a Campaign is what gets funded, an Ad is what runs.
_Avoid_: Ad campaign, promotion (a Discount is not a Campaign)

**Ad**:
One creative running under a Campaign — the thing a visitor actually sees. Owns
its own Ad Tag, flight dates, creative and Spend, so two variants of one
Campaign can be told apart. A Campaign may have none: an Ad is a subdivision a
merchant opts into, never a wrapper invented around a Campaign that has one.
_Avoid_: Creative (that is the image, not the Ad), variant, ad unit, placement

**Matching Rule**:
One statement by a merchant that a Campaign owns a value — a UTM field or a
referrer host, compared with `equals` or `starts_with`. Both sides are compared
normalized (trimmed, lowercased, hyphens/underscores/whitespace collapsed), so
`summer_sale` and `Summer-Sale` are one rule, not two. Applied at read time, so
adding one repairs past reports as well as future ones. A rule belongs to a
Campaign or to an Ad, and the two are never in one contest: the Campaign is
resolved first, and an Ad only among that Campaign's own Ads.
_Avoid_: Filter, mapping, pattern, alias

**Campaign Tag**:
The canonical `utm_campaign` value one Campaign owns — a slug derived from its
name at creation, unique within the Store, and fixed thereafter so links already
running in an ad platform keep matching after a rename. Every Campaign is
created already owning a Matching Rule on its own Tag.
_Avoid_: Slug, code, campaign id (that is the ad platform's `external_id`)

**Ad Tag**:
The canonical `utm_content` value one Ad owns — unique within its Campaign
rather than within the Store, so every Campaign is free to call its variants
`video-a` and `still-b`. Fixed at creation for the same reason a Campaign Tag
is: a link already running cannot be recalled.
_Avoid_: Content tag, creative id, variant code

**Placement**:
Where on a platform an Ad was shown — Instagram feed, Facebook stories. Carried
for recognition only, filled in by a sync and blank otherwise. Not a dimension
anything is reported by, because one Ad runs in several at once.
_Avoid_: Channel, surface, position, network

**Tagged Link**:
A URL generated from a Campaign for a page of the Store, carrying that
Campaign's Tag alongside a chosen source and medium. Derived rather than stored:
the same choices always produce the same URL, and links differing only by source
or medium report as one Campaign. A convenience, not a precondition — a link
tagged by hand before its Campaign existed is still claimable by a Matching Rule.
_Avoid_: Tracking link, UTM builder, short link

**Touch**:
A single recorded instance of a Visitor arriving from a traffic source, carrying
its UTM tuple and referrer. A Session may contain several Touches.
_Avoid_: Click, visit, hit, touchpoint

**Attribution**:
The record of which Campaign an Order is credited to. Captured as an immutable
snapshot on the Order at checkout, in the same spirit as line-item snapshots —
it reflects acquisition conditions at purchase time and never changes afterward.
_Avoid_: Source, tracking, origin

**Declared Attribution** / **Correlated Attribution**:
Where an Order's evidence came from. _Declared_ was passed by the storefront on
cart creation and is authoritative (ADR-0001). _Correlated_ was inferred at
checkout from the tracked events of the Cart's Session, so an integrator who has
not implemented pass-through still gets partial reporting — a backstop, never
the primary source, because the event stream behind it is ad-blockable and is
eventually deleted by the retention purge. Recorded on every Order so a merchant
can tell a fact from an inference and judge how far to trust it.
_Avoid_: Inferred, guessed, auto-attribution, fallback attribution

**First Touch** / **Last Touch**:
The earliest and the latest non-direct Touch within the Lookback Window before
an Order. Both are stored on every Order; neither is privileged in the data
model, and the UI chooses which to display.
_Avoid_: First click, last click, first/last interaction

**Lookback Window**:
How far back before an Order a Touch may be and still receive credit. A reported
figure, always displayed alongside any ROAS, because a different window is why
our numbers and an ad platform's numbers disagree.
_Avoid_: Attribution window, conversion window

**Unattributed**:
An Order with no qualifying Touch in the Lookback Window. Always its own visible
bucket; never silently redistributed across Campaigns.
_Avoid_: Direct, organic, unknown, other

**Unassigned**:
An Order a Campaign claimed but none of its Ads did — an untagged link, a typo,
an Ad created after the fact. Its own visible bucket inside the Campaign, on the
same principle as Unattributed: never spread across whichever Ads happen to
exist.
_Avoid_: Other, remainder, leftover, unattributed (that is the Store-level one)

**Spend**:
Money an Organization paid, recorded one row per day against a Campaign and,
where the merchant has split it, against one of that Campaign's Ads. In the
Store's currency and in minor units like all other money here. A row naming no
Ad means the cost is known and its split is not — never that it belongs to no
Ad.
_Avoid_: Cost, budget, ad cost

**Reported Figure**:
A number an ad platform states about a Campaign or an Ad — its own spend, ROAS
or conversions, on its own attribution window and in its ad account's currency.
Kept beside our figures and always labelled with its source, never merged into
them and never an input to Contribution Margin, which has no cost basis behind
it.
_Avoid_: Actual spend, true spend, platform truth, synced metrics

**Platform State**:
What an ad platform says an Ad is doing right now — approved, rejected, in
review, delivering, paused. Read-only, and absent for anything not synced.
Distinct from an Ad's status, which is the merchant's own lifecycle and is never
overwritten by it.
_Avoid_: Status (unqualified), review status, delivery status

**Unlinked Ad**:
An ad a platform is spending on that no Ad in the Store claims yet. Held for the
merchant to claim onto a Campaign or dismiss, never created automatically — an
Ad invented from a sync carries cost with no way to earn revenue, and would read
as the worst performer in the account.
_Avoid_: Orphan, unmatched, imported ad, pending ad

**ROAS**:
Attributed revenue ÷ Spend for a Campaign or one of its Ads over a period. Compared against ad
platforms, so it moves with the Lookback Window.
_Avoid_: Return, ad ROI

**Contribution Margin**:
Attributed revenue − cost of goods − discounts − Spend, for a Campaign or one
of its Ads. The
figure that says whether to keep spending, where ROAS only says how much came
back. Reported with its cost-price coverage, never as a bare number.
_Avoid_: Profit, net, margin (unqualified)

## Content

**Content Slot**:
A named, Store-scoped region a storefront renders — `homepage.hero`,
`plp.banner`. Holds typed content, addressed by a stable key the storefront
knows about. Not a page, and not composed of arbitrary nested blocks.
_Avoid_: Block, section, widget, component, page

**Slot Draft**:
A Content Slot's unpublished value. Visible to the merchant in the editing
frame and nowhere else — no public read returns one, under any argument. A Slot
holds one draft and one published value, and no history of either.
_Avoid_: Version, revision, preview, staged

**Publishing** (a Slot):
The deliberate act that makes a Slot's draft the value shoppers see. Separate
from saving, so going live is a decision rather than a side effect of typing.
An entity field has no equivalent: it is live the moment it is saved, and the
editor says so where the merchant is working.
_Avoid_: Deploy, go live, commit, release

**Inline Editing**:
Editing a field in place on the rendered storefront rather than in a form in the
admin. The editable target is always an existing entity field or a Content Slot;
never a free-form layout.
_Avoid_: Visual editing, page building, WYSIWYG

**Starter Storefront**:
The first-party, forkable storefront in `apps/storefront`. Reference
implementation of every public contract — attribution pass-through, event
tracking, the Inline Editing protocol — and the place those contracts are proven
before integrators meet them.
_Avoid_: Template, theme, demo, example
