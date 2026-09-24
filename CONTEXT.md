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
catalog namespace, and the address its storefront is reached at. One
Organization may own several Stores.
_Avoid_: Shop, site, channel

**Storefront URL**:
The absolute address a Store's storefront is served at, set by the merchant.
The engine is headless, so it cannot know this — until it is set, nothing can
build a link into the storefront. Stored without a trailing slash, and never
with a query string or fragment.
_Avoid_: Domain, site URL, base URL, store URL (which is the Store's slug)

**Product Path Pattern**:
The shape of a Store's product page paths, carrying `{slug}` where the product
goes — `/products/{slug}` by default, matching the Starter Storefront. A
merchant who forked it and moved the route says so here. The all-products page
is read off the same pattern rather than configured separately.
_Avoid_: Route, permalink, URL template

**Destination**:
Where a link points on a Store's own storefront: a product, the all-products
page, the home page, or a custom path. Anywhere else is refused, because the
capture script only reads link tags on the Store's own storefront — a
destination elsewhere is a campaign that cannot be measured.
_Avoid_: Landing page, target, link URL

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
One campaign on an ad platform, in the ad account a Store has connected — the
thing a merchant funds, whose budget, schedule and audience the platform holds.
Born one of two ways, created here and pushed to the platform or created in the
platform's own ad manager and discovered, and the same record either way. Always
paid media on a single platform: a newsletter, an SMS blast or an influencer
deal is not a Campaign, though the Touches that traffic leaves are still kept on
every Order.
_Avoid_: Ad campaign, promotion (a Discount is not a Campaign), UTM campaign

**Ad**:
One creative running under a Campaign — the thing a visitor actually sees and
clicks. The finest grain Spend, Impressions and Clicks are reported at, and the
finest grain revenue is credited to.
_Avoid_: Creative (that is the image, not the Ad), variant, ad unit, placement

**Ad Set**:
The platform's layer between a Campaign and its Ads, where the audience and
sometimes the budget live. Not a thing here: a Campaign created here has exactly
one, with the budget on the Campaign, and a discovered Campaign's Ads are read
as its own whichever Ad Set they sit in.
_Avoid_: Ad group, audience, targeting

**Creative**:
The picture an Ad is recognised by — its image, or a video's poster frame.
Uploaded here, or picked from a Product's own photographs, when the Ad is
created here; read from the platform when it was made there. Nothing that reads
it can tell which.
_Avoid_: Ad image, thumbnail, asset, media (that is a Product's)

**Cover**:
The image a Campaign is recognised by. A platform campaign has none of its own,
so it starts as an Ad's Creative — the first Ad's for a Campaign created here,
the highest-spending Ad's for one discovered — and the merchant may swap it for
another Ad's or an upload. A copy is kept here, since a platform's image links
expire.
_Avoid_: Thumbnail, banner, hero, campaign image

**Link Tags**:
The UTM parameters written onto an Ad's link, naming the platform's own campaign
id and ad id, which the platform fills in at the moment of the click. What joins
an Order's Last Touch to a Campaign and an Ad; an id never changes on a rename,
where a name would. Written on every Ad created here, in the same call that
creates it, and read back to confirm. A discovered Campaign whose
Ads lack them is **Not Tracked** — its revenue is unknown rather than zero —
until the merchant chooses to have them written, which the platform treats as a
new creative and sends back through review. A Campaign is **Tracked** only when
it has Ads and every one of them carries ours; a discovered Ad's tags are read
once, when the Sync first sees it.
_Avoid_: Tracking tags (the vendor's name for a pixel), UTM template, Ad Tag,
Tagged Link

**Format**:
How an Ad's creative is built — single image, video or carousel, as the platform
classifies it. The one thing said about an Ad beside its name. Where the Ad was
shown is deliberately not carried: with automatic placements one Ad runs on
every surface at once, so there is no single answer to give.
_Avoid_: Creative type, placement, ad type

**Dry Run**:
The platform's own check of a Campaign before it is created, with nothing
created. Its complaints (a budget under the minimum, an image the wrong size,
copy it rejects) are shown on the form beside the field they are about. Every
create passes one first. It cannot see a video that has not been uploaded yet,
so a complaint about a video arrives with the create instead.
_Avoid_: Validation (ours are the rules checked before it), preview

**Touch**:
A single recorded instance of a Visitor arriving from a traffic source, carrying
its UTM tuple and referrer. A Session may contain several Touches.
_Avoid_: Click, visit, hit, touchpoint

**Attribution**:
The record of which Campaign an Order is credited to. Captured as an immutable
snapshot on the Order at checkout, in the same spirit as line-item snapshots —
it reflects acquisition conditions at purchase time and never changes afterward.
The snapshot carries the measurement evidence for the same arrival: the Browser
Identifiers and the visitor's Measurement Consent, frozen by the same copy and
for the same reason.
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
an Order. Both are stored on every Order. A Campaign's revenue goes to the
latest ad click: the Last Touch if it names a Campaign, otherwise the First
Touch if it does — so an untagged visit after an ad click, such as a search for
the Store's name, does not cancel the ad's credit, just as it would not at the
platform.
_Avoid_: First click, last click, first/last interaction

**Lookback Window**:
How far back before an Order a Touch may be and still receive credit. Stated
where a Campaign's figures are read, because a different window is one reason
our numbers and an ad platform's disagree.
_Avoid_: Attribution window, conversion window

**Unattributed**:
An Order where neither the First nor the Last Touch in the Lookback Window names
a Campaign. Never silently redistributed across Campaigns.
_Avoid_: Direct, organic, unknown, other

**Unassigned**:
An Order whose Last Touch names a Campaign but none of its Ads — only possible
when Link Tags were edited by hand. Counted in the Campaign's revenue, and shown
as its own line only when there is any; never spread across the Ads that happen
to exist.
_Avoid_: Other, remainder, leftover, unattributed (that is the Store-level one)

**Spend**:
What the ad platform charged a Store's ad account for an Ad on a day, as the
platform reports it; a Campaign's Spend is the sum of its Ads'. Never typed by
the merchant. In the Store's own currency — an ad account billed in any other is
never connected — and in minor units like all other money here.
_Avoid_: Cost, budget (that is the platform's cap, not what it charged), ad cost

**Impressions**:
How many times the platform showed an Ad, as the platform counts them. Never
called _views_: a view of a video ad is a different and much smaller platform
count.
_Avoid_: Views, reach (that counts people, not showings)

**Clicks**:
How many times people followed an Ad through to the Store, as the platform
counts them. Only clicks on the Ad's link — never a like, a comment or a tap
that opened the image, which a platform may count as a click of its own.
_Avoid_: Link clicks (in copy), clicks (all), engagement, visits

**Status** (of a Campaign or Ad):
What the platform says it is doing, read from the platform and never kept
separately here: **Active**, **Paused**, **In review**, **Needs attention**
(rejected, has issues, or errored) or **Ended** (its schedule is over, or it was
deleted on the platform — it still spent money, so it is never hidden). Changed
here only by pausing or resuming through the platform.
_Avoid_: Platform State, delivery status, review status, archived

**Ad Account**:
The account at the ad platform that a Store's spend is charged to, and the unit
a Campaign belongs to. The merchant chooses which of theirs a Store reports
against, in the admin and not on the platform's screen — the platform has never
heard of the Store. One billed in a currency other than the Store's is offered
and refused, with the reason, because nothing here converts a figure.
_Avoid_: Ad manager, business account, advertiser, profile

**Ad Platform Connection**:
One Store's link to one ad platform — the ad account a merchant approved on the
platform's own screen, and when access was last granted. Per Store and never per
Organization: a US store and a UK store approve separate ad accounts, because
Campaigns and currency are both Store-scoped. Only an ad account billed in the
Store's own currency can be connected, so no figure here is ever converted.
Approving and choosing an Ad Account are two steps, and the state between them
is durable: a merchant who closes the tab, or picks an account that is refused,
does not go back through the platform's approval screen. Disconnected, never
deleted, so revoking access cannot rewrite the reports it produced.
_Avoid_: Integration, app, install, linked account

**Sync**:
Reading a Store's connected Ad Account into Campaigns, Ads and each Ad's daily
Spend, Impressions and Clicks — hourly, on Refresh, and once as part of
connecting, which reaches back over the history the platform offers. The only
writer of what the platform reports. It re-reads the last week every time,
because the platform restates recent days, and running it twice changes
nothing. A Campaign on the account with no row here is simply inserted; one the
platform stops reporting reads Ended and keeps its history. The one part of the
feature that is slow or fails, so it never sits in a read: a failure is recorded
on the connection and shown beside the figures already held.
_Avoid_: Import, ingest, claim, refresh job

**Ad Platform Provider**:
The interface every reach for an ad platform goes through, and the only place
this codebase talks to one — reading Campaigns and their figures, and creating
or changing them on the merchant's behalf. One adapter knows the vendor's name
and nothing else does. Named after the capability, never after whoever
currently implements it.
_Avoid_: The vendor's name, ad API, ads client, sync provider

**Pixel**:
The ad platform's measurement tag belonging to a Store's connected ad account,
which the storefront loads to report browsing — pages viewed, products viewed,
carts started. Found on the ad account or created at connection, and switched on
in the storefront by connecting rather than by configuring the storefront. A
Store may require a visitor's consent first, which holds back the Pixel and the
Purchase Event alike; off unless the Store turns it on.
_Avoid_: Tracking tag, tag, tracker (that is ours), script

**Purchase Event**:
What the ad platform is told about a paid Order, so it can learn who buys and
optimise a Campaign for sales. Sent twice, once by the storefront's Pixel and
once by the server, carrying the Order's id so the platform counts it once; the
server's is the one that survives an ad-blocker. Sent for every paid Order, not
only credited ones, because the platform does its own attribution. Carries the
Order's total and currency and whatever identifies the buyer — their contact
details and the Browser Identifiers frozen at checkout — and never a refund: the
platform has no retraction, so a refunded Order is reported and left reported.
_Avoid_: Conversion, conversion event, CAPI event, sale

**Purchase Dispatch**:
One Order's Purchase Event as a thing with a state: owed, sent, withheld because
the buyer did not agree to be measured, or expired because the platform can no
longer attribute it. It exists because reporting must never be able to fail a
sale, which means the send happens after the payment and can therefore be owed at
a moment nobody is watching — the record is what lets a refusal be retried
without a success being reported twice. Nothing a merchant reads shows it; a
purchase being slow to reach an ad platform is not a thing a merchant can act on.
_Avoid_: Conversion queue, event log, outbox, retry

**Measurement Consent**:
A visitor's answer to whether they may be measured, and the Store switch that
decides whether they are asked. The switch is off unless a merchant turns it on,
so a Store selling only where consent is not required shows no banner. With it
on, the storefront loads no Pixel, runs no tracking script and captures no
Browser Identifier until the visitor accepts, and declining is one click, the
same as accepting. The answer is frozen onto the Order with the rest of the
Attribution Snapshot, because what may be reported about a purchase is decided
by what the person buying said and has to still be readable days later.
_Avoid_: Cookie banner, GDPR flag, opt-in, tracking preference

**Browser Identifier**:
The ad platform's own ids for the browser a visit came from — the one it keeps
for the browser, and the one it derives from the click that brought them. Read
at landing, because the click's id is gone from the URL by the next page, and
frozen onto the Order so a Purchase Event sent later can still be matched to a
person. Captured only where Measurement Consent allows it.
_Avoid_: Cookie id, fbp/fbc (in copy), tracking id, device id

**ROAS**:
Attributed revenue ÷ Spend for a Campaign or one of its Ads over a period.
Moves with the Lookback Window.
_Avoid_: Return, ROI (that is profit over Spend)

**Conversion Rate**:
Orders ÷ Clicks for a Campaign or one of its Ads over a period — the Orders
ours, the Clicks the platform's. A period ratio and not a cohort one: this
period's Orders over this period's Clicks, never the fate of those who clicked.
Reads slightly low, because some who click leave before the Store's page loads.
_Avoid_: CVR, conversion, close rate, checkout rate

**Contribution Margin**:
Attributed revenue − cost of goods − discounts − Spend, for a Campaign or one
of its Ads. The figure that says whether to keep spending, where ROAS only says
how much came back. Absent unless every item sold has a cost price — never
estimated from the part that has one. Attributed revenue is Order totals, which
are already net of discounts, so discounts are taken off once, there.
_Avoid_: Profit, net, margin (unqualified)

**ROI**:
Contribution Margin ÷ Spend for a Campaign or one of its Ads — what each unit of
Spend returned after the goods and the ads are paid for. Absent whenever
Contribution Margin is.
_Avoid_: Return, profit %, ROAS (that is revenue over Spend, before any cost)

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
