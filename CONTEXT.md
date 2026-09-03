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
where applicable, an external ad-platform id. Deliberately *not* the same object
as a UTM string: one Campaign absorbs many UTM variants via its matching rules.
_Avoid_: Ad, ad campaign, promotion (a Discount is not a Campaign)

**Touch**:
A single recorded instance of a Visitor arriving from a traffic source, carrying
its UTM tuple and referrer. A Session may contain several Touches.
_Avoid_: Click, visit, hit, touchpoint

**Attribution**:
The record of which Campaign an Order is credited to. Captured as an immutable
snapshot on the Order at checkout, in the same spirit as line-item snapshots —
it reflects acquisition conditions at purchase time and never changes afterward.
_Avoid_: Source, tracking, origin

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

**Spend**:
Money an Organization paid for a Campaign, recorded one row per Campaign per
day, in the Store's currency and in minor units like all other money here.
_Avoid_: Cost, budget, ad cost

**ROAS**:
Attributed revenue ÷ Spend for a Campaign over a period. Compared against ad
platforms, so it moves with the Lookback Window.
_Avoid_: Return, ad ROI

**Contribution Margin**:
Attributed revenue − cost of goods − discounts − Spend, for a Campaign. The
figure that says whether to keep spending, where ROAS only says how much came
back. Reported with its cost-price coverage, never as a bare number.
_Avoid_: Profit, net, margin (unqualified)

## Content

**Content Slot**:
A named, Store-scoped region a storefront renders — `homepage.hero`,
`plp.banner`. Holds typed content, addressed by a stable key the storefront
knows about. Not a page, and not composed of arbitrary nested blocks.
_Avoid_: Block, section, widget, component, page

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
