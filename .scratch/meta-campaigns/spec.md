# Meta Campaigns

Status: ready-for-agent

The marketing section, rebuilt around the ad platform instead of around a
spreadsheet. It replaces Stage 5 (`.scratch/ad-cards/`) and Stage 6
(`.scratch/ad-ingest/`) rather than building on them, and most of what those two
stages shipped is deleted here.

Respects **ADR-0001** (attribution snapshot on Order) and **ADR-0006**
(Campaigns are the ad platform's campaigns, managed through one vendor).
ADR-0002, ADR-0004 and ADR-0005 are superseded by ADR-0006 and must not be used
to justify anything in this stage.

The vendor is **Zernio** (`docs.zernio.com`), and the vendor is not negotiable
mid-build: if something about it does not work, stop and raise it. The previous
stage silently substituted a different vendor, which is the reason this stage
exists in the form it does.

## Problem Statement

The merchant opens the campaigns page and is shown everything except the answer.

There is a KPI strip, a period selector, a first/last-touch toggle, a filter
bar, a card/table switch, a matching-rules editor with a preview panel, a spend
card with two entry modes, a queue of unlinked ads waiting to be claimed, the
platform's figures printed beside ours with a paragraph explaining why they
disagree, and a traffic figure that has to be drawn differently because it
cannot be trusted. The question the merchant actually has is: *which campaigns
are running, and how much money did each one make me?*

Underneath the clutter is a worse problem: the numbers arrive by hand. Spend is
typed in, one day at a time, per ad. Revenue per ad depends on the merchant
remembering to paste a tagged link into Meta before the ad goes live. Both decay
the moment the merchant gets busy, and a report that decays is a report nobody
trusts — the merchant knows which Tuesday they skipped.

And the two systems never meet. The merchant builds ads in Meta Business Suite,
where they already work. Money leaves the ad account and this system knows
nothing about it, so every ROAS on the page is overstated by whatever was spent
elsewhere.

## Solution

Two screens, and the platform does the bookkeeping.

**The grid** answers the glance question and nothing else: a card per campaign
carrying its attributed revenue for the last 30 days, its cover image, its name,
its platform and its status. Search, and a Create button.

**The detail page** answers the next question: the cover, one performance panel,
and the ads that ran underneath, one row each. No tabs, no toggles, no second
opinion printed beside the first.

Behind them, a Meta ad account connected once. From then on every campaign on
that account is here — the ones created from this admin, pushed to Meta through
Zernio, and the ones built in Ads Manager, discovered by the sync. Spend,
impressions and clicks come from Meta. Revenue, orders, ROAS, ROI and conversion
rate are computed here from Orders.

The join between the two halves is written by us, not by the merchant. Every ad
created here carries Link Tags — `utm_campaign={{campaign.id}}` and
`utm_content={{ad.id}}` — which Meta fills in at the moment of the click. An ad
is therefore measurable before it has ever been seen, and a rename never breaks
it. An ad built in Ads Manager has no such tags, so its campaign reads **Not
Tracked** rather than $0, with one button that writes them.

Purchases flow back the other way. The Starter Storefront loads the ad account's
pixel, and every paid Order is also reported from the server, so Meta can
optimise a campaign for sales rather than for cheap clicks.

The manual system is not kept as a fallback. It is deleted.

## User Stories

**At a glance**

1. As a merchant, I want to open Campaigns and see which campaigns are running
   and what each one earned, without reading anything else first.
2. As a merchant, I want each card to show the campaign's own creative, so that
   I recognise it the way I think of it rather than by its name.
3. As a merchant, I want one revenue window across every card, so that the cards
   are comparable with each other.
4. As a merchant, I want running campaigns before finished ones, so that the
   thing I can still act on is at the top.
5. As a merchant, I want campaigns that ended long ago out of my way but not
   gone, so that the page does not fill up with history.
6. As a merchant, I want to search campaigns by name, so that I can find one in
   a long list.
7. As a merchant, I want a campaign whose revenue cannot be measured to say so,
   so that I never read an untracked campaign as a failed one.

**The detail page**

8. As a merchant, I want a campaign's revenue, spend, impressions and orders on
   one panel, so that I can judge it without assembling it.
9. As a merchant, I want its ROAS, so that I know what came back per unit spent.
10. As a merchant, I want its ROI after product costs, so that I know whether it
    actually made me money.
11. As a merchant, I want ROI withheld rather than guessed when I have not
    entered cost prices, so that I am never shown a confident wrong number.
12. As a merchant, I want its conversion rate, so that I can tell a traffic
    problem from a persuasion problem.
13. As a merchant, I want each ad in the campaign on its own row with its own
    spend and revenue, so that I can see which creative carried it.
14. As a merchant, I want the ad rows to add up to the campaign, so that I can
    trust both numbers.
15. As a merchant, I want to know how each ad is built — image, video, carousel
    — so that I can tell my variants apart.
16. As a merchant, I want to choose the period on this page, so that I can look
    at a week, a month, a quarter or the whole campaign.
17. As a merchant, I want a finished campaign to open on its lifetime, so that I
    do not land on a page of zeroes.
18. As a merchant, I want to see the lookback window stated once, so that I
    understand why Meta's own dashboard says something different.

**Creating a campaign**

19. As a merchant, I want to create a campaign without leaving this admin, so
    that I am not maintaining the same thing in two places.
20. As a merchant, I want to set a daily budget and the dates it runs, so that I
    control what it can spend.
21. As a merchant, I want to choose countries and an age range, and leave the
    rest of the targeting to the platform, so that I am not made to be a media
    buyer.
22. As a merchant, I want to add several ads to one campaign, so that I can test
    creatives against each other.
23. As a merchant, I want to use a product's own photo as an ad image, so that I
    do not have to export and re-upload what this system already holds.
24. As a merchant, I want to point an ad at one of my products, so that the
    click lands where it should.
25. As a merchant, I want the campaign to be measurable the moment it launches,
    without pasting a link anywhere.
26. As a merchant, I want to be told what is wrong with my campaign before it is
    created, so that I fix it on the form rather than after the fact.
27. As a merchant, I want to save a campaign paused, so that I can look at it
    again before it spends anything.
28. As a merchant, I want my campaign optimised for purchases rather than
    clicks, so that the platform looks for buyers.

**Changing one**

29. As a merchant, I want to pause a campaign from here, so that I can stop
    spending immediately when something is wrong.
30. As a merchant, I want to pause one ad without pausing the campaign, so that
    I can cut the creative that is not working.
31. As a merchant, I want to change the budget and the end date, so that I can
    feed a winner and time a promotion.
32. As a merchant, I want to add an ad to a running campaign, so that I can
    refresh a creative without starting again.
33. As a merchant, I want to rename a campaign without breaking its reporting,
    so that names stay useful.
34. As a merchant, I want to choose the cover image, so that the grid looks like
    my campaigns.
35. As a merchant, I do NOT want to be able to edit a live ad's creative or
    audience here, so that I cannot accidentally reset what the platform has
    learned.

**Connecting**

36. As a merchant, I want to connect Meta once, on Meta's own approval screen,
    so that I am granting access with my own credentials.
37. As a merchant with several ad accounts, I want to choose which one this
    store uses, so that the right money is measured against the right store.
38. As a merchant, I want an ad account in the wrong currency refused with a
    reason, so that I am never shown figures that were silently converted.
39. As a merchant, I want history pulled when I connect, so that the page is
    useful on day one.
40. As a merchant, I want to see how fresh the figures are, so that I do not
    read a stale number as a live one.
41. As a merchant, I want to refresh by hand, so that I can check after making a
    change.
42. As a merchant, I want a sync failure to be visible and never to break the
    page, so that a vendor outage costs me freshness and not my dashboard.
43. As a merchant, I want to disconnect, and to keep everything already pulled,
    so that revoking access does not rewrite my history.
44. As a merchant with several stores, I want each store connected separately,
    so that two stores never share an ad account.
45. As a merchant, I want my ad account unreachable from any other tenant, so
    that the connection is as isolated as the rest of my data.

**Measurement flowing back**

46. As a merchant, I want the platform to know when a purchase happens, so that
    it can find more buyers.
47. As a merchant, I want purchases reported even when a visitor blocks scripts,
    so that the platform's picture is not half-missing.
48. As a merchant, I want a purchase counted once even though it is reported
    twice, so that the platform's numbers are not doubled.
49. As a merchant, I want the pixel to switch on by connecting, not by editing
    my storefront, so that measurement is not a deployment.
50. As a merchant selling into the EU, I want to ask visitors for consent first,
    so that I am not tracking people who have not agreed.
51. As a merchant selling only where consent is not required, I do NOT want a
    banner, so that my storefront is not worse for no reason.

## Implementation Decisions

### The vendor and the seam

One provider interface, `AdPlatformProvider`, with a **Zernio** adapter behind
it, following the `PaymentProvider` precedent. The interface keeps its name and
the adapter carries the vendor's: `zernio.adapter.ts` is the only file in the
codebase that knows the vendor exists.

The seam survives ADR-0006 for one reason only — it is where the in-memory fake
is swapped in for end-to-end tests. It is **no longer read-only**: it gains
create, update and status methods, and `ad-platform-provider.contract.spec.ts`
must be extended to cover them so the fake and the adapter cannot drift.

Delete `ayrshare.adapter.ts` in the same commit that adds the Zernio one. Do not
port it.

### Connecting a Store to Meta

- One **profile per Store** in the vendor, and one **scoped API key per Store**,
  reusing the existing `ad_platform_credentials` table. This is mandatory, not
  tidy: the vendor's write endpoints accept any account id the *team* owns
  regardless of profile, which is the inverse of this codebase's tenancy
  guarantee. Credentials are secrets: never returned by a read, never logged.
- The merchant is sent to Meta's own approval screen and lands back in the
  admin. Meta requires a Facebook Page to run ads, so the Page is chosen during
  that flow.
- If the Meta login can see several ad accounts, we render a **picker**. Accounts
  whose currency is not the Store's currency are listed but **disabled, with the
  reason shown**. Connecting one is refused server-side as well, so a currency
  mismatch can never enter the system and no conversion logic exists anywhere.
- At connection we list the ad account's pixels and take the first, or create one
  named after the Store. Its id is stored on the connection.
- On first connection, backfill the history the platform offers (90 days) rather
  than starting from today.
- Connect and disconnect require `super_admin`. Everything else on these screens
  requires `campaigns.write`, which stays as it is (`super_admin` and
  `product_manager`).

### What a Campaign is

A Campaign row is one Meta campaign on the Store's connected ad account, keyed
by `(store_id, external_id)` where `external_id` is Meta's campaign id. It is
created one of two ways and there is no third:

- **Created here.** We call the vendor's create endpoint, which builds campaign →
  ad set → ads in one call, and store the ids it returns.
- **Discovered.** The sync finds a campaign on the ad account that we have no row
  for, and inserts one. This is a straight insert — there is no claim queue, no
  pending state and no dismiss. ADR-0005's reason for holding them back (an
  auto-created ad carries cost with no way to earn revenue) is answered by the
  Not Tracked state instead, which says exactly that on the card.

Ads are the same: keyed by Meta's ad id, created here or discovered. The **ad
set level is not modelled**. A campaign created here always has exactly one, with
the budget on the campaign. A discovered campaign's ads are read as the
campaign's own whichever ad set they sit in; when its budget is per ad set, the
budget field in Edit is disabled and says to edit it in Ads Manager.

Nothing here has a status of its own. Status is read from the platform and
collapsed to five values — **Active, Paused, In review, Needs attention, Ended**
— from the delivery status, the review status and the schedule. A campaign
deleted on Meta reads Ended and stays visible: it spent money.

### Link Tags and the join

Every ad created here is created with its tags, in the same call that creates it:

```
utm_source=meta  utm_medium=paid
utm_campaign={{campaign.id}}  utm_content={{ad.id}}
```

Meta expands the placeholders at click time. An Order's stored touch therefore
carries Meta's own ids, and the join is an equality check against
`campaigns.external_id` and `ads.external_id`. There is no normalization, no
precedence order and no matching rules — that machinery is deleted.

Revenue is credited to the **latest ad click**: the Order's last touch if it
names a Campaign, otherwise its first touch if it does. This is the one place
the rule is written; do not re-implement it per report.

A discovered ad carries whatever tags its author gave it, usually none. On
discovery we read each new ad's tags once. A Campaign is **Tracked** when every
one of its ads carries our tags, and **Not Tracked** otherwise. A Not Tracked
campaign shows revenue as unknown (an em dash and the words "Not tracked"),
never as `$0`, and offers **Start tracking**, which writes the tags to all its
ads. That button must warn, before acting, that Meta rebuilds the creative and
re-reviews the ad. Ads built from an existing Facebook or Instagram post cannot
be retagged without losing the post's engagement; the vendor rejects those, and
the failure is reported per ad rather than failing the whole action.

### Sync

Poll-only; no webhook endpoint in this stage.

- A `@Cron` job per connected Store, hourly, as the existing reservation-expiry
  and rollup jobs already do. The sync method is a plain public method so it can
  be invoked directly, including by the Refresh button and by the code path that
  runs right after any edit made here.
- One call per sync: the ad tree with a daily breakdown at ad level, over the
  window that needs refreshing. That window is **the last 7 days plus everything
  since the last successful sync**, because Meta restates recent days.
- Idempotent by construction: rows are upserted on `(ad_id, day)`.
- Figures land in **one new table**, per Ad per day: spend (minor units),
  impressions, clicks. That is all we keep of the platform's. Its reported
  revenue, conversions and ROAS are **not stored and not displayed**.
- Failures are recorded on the connection (`last_sync_error`,
  `sync_failure_count`, `sync_paused_until`) and surfaced in the connection
  panel. **A sync failure is never thrown into a merchant's read path.** Back off
  rather than retry hard: some upstream quotas are shared across all of the
  vendor's customers, so a refusal may have nothing to do with this account —
  the message shown must not blame the merchant's own account.
- On disconnect, everything stays and freezes. The page shows a banner naming
  the date of the last figures, and Create and Edit are disabled.

### The figures

Ours, from Orders:

- **Attributed revenue** and **Orders**, over the selected period, using the
  existing realized-revenue statuses so this page reconciles with the dashboard
  and analytics.
- **ROAS** = revenue ÷ spend. Null, not zero or infinity, when spend is zero.
- **Contribution Margin** = revenue − cost of goods − discounts − spend, and
  **ROI** = margin ÷ spend. Both are **withheld entirely unless every item sold
  in the period has a cost price**; the panel shows an em dash and a link to
  add cost prices. Partial coverage is not reported as a number.

Theirs, from the platform, labelled as measurements:

- **Spend**, **Impressions**, **Clicks**.
- **Conversion rate** = our Orders ÷ their Clicks.

`Clicks` must mean link clicks — people who reached the Store. The vendor's docs
do not say which figure its `clicks` field carries, and Meta's own `clicks`
includes likes and image taps. **Verify this against a real connected account
before this stage is called done**; if it is the wrong one, read link clicks from
the insights endpoint instead. A conversion rate built on "clicks (all)" is
meaningless and will not look wrong.

Money: the vendor reports decimals (`493.39`) and takes budgets in whole units
(`75` = $75.00). Convert at the adapter edge, with an explicit and tested
rounding rule. **No float reaches a service, a repository or a report.**

### The grid

- Cards: cover, name, platform, status, and attributed revenue for a **fixed**
  last-30-days window, labelled once at the top of the page. No period picker
  and no touch toggle on this page.
- Membership: every campaign that is not Ended, plus those that ended within the
  window. A quiet "Show older campaigns (N)" link reveals the rest.
- Order: Active, then In review / Needs attention / Paused, then Ended; within a
  group, by revenue.
- Search by name.
- Before a connection exists the whole page is a single empty state with one
  button, **Connect Meta**. After it, the header carries a small
  "Meta · *account* · updated 12 min ago" link opening a panel with the account,
  Refresh and Disconnect.

### The detail page

- Header: name, status, "Meta Ads · *schedule*", period picker (7 / 30 / 90 days
  and Lifetime; default 30 days, or Lifetime when the campaign is Ended), and
  Edit.
- Cover on the left; performance panel on the right: attributed revenue, spend,
  impressions, orders, conversion rate, ROI, then clicks and ROAS on a footer
  row. The lookback window is stated once, in that footer.
- Ads table: thumbnail, name, format, status, spend, impressions, clicks,
  orders, revenue, ROAS, and a campaign total row. A muted **"Not linked to an
  ad"** row appears only when some of the campaign's revenue named no ad, which
  can only happen if tags were hand-edited.
- Creative images are **copied into our own storage** on first sight. The
  platform's image URLs are signed and expire within about a day.

### Creating a campaign

One form:

1. Name.
2. Daily budget in the Store's currency, a start date, an optional end date.
3. Countries and an age range. Everything else is left to the platform's
   automatic targeting.
4. One to six ads. Each: an image or video (uploaded, or **picked from a
   product's media**), primary text, headline, a button (default "Shop now"),
   and a destination.
5. Publish, or Save as paused.

Fixed, and not offered as choices: the goal is always **Sales**, optimising for
the pixel's Purchase event; placements are automatic; bidding is the platform's
default; there is exactly one ad set; the budget is on the campaign.

The form is validated against the platform's **dry-run** before anything is
created, so budget minimums, image dimensions and rejected copy surface on the
form. The create call carries an `Idempotency-Key`, matching how checkout
already behaves.

A destination is a product, all products, the home page, or a custom path — and
always on the Store's own storefront, because that is where our capture script
reads the tags. This needs two new Store settings: a **storefront URL** and a
**product path pattern**, defaulting to `/products/{slug}` to match the Starter
Storefront.

The Cover defaults to the first ad's image; for a discovered campaign it is the
image of the ad that spent the most.

### Editing

Rename, daily budget, end date, pause/resume the campaign, pause/resume a single
ad, add an ad, change the cover. Nothing else.

Audience, goal and an existing ad's creative are deliberately absent: the first
two reset the platform's learning, and the third replaces the creative and sends
the ad back through review, losing its accumulated engagement. The supported
move is to add a new ad and pause the old one. There is no delete — deletion on
the platform cannot be undone, and pausing achieves what the merchant wants.

### Purchases flowing back

- **Pixel in the Starter Storefront**, for page views, product views and carts
  started. The storefront reads the pixel id from the public API, so connecting
  Meta switches it on with no redeploy and no storefront configuration. An
  unconnected Store serves no pixel.
- **Server-side Purchase** for every paid Order — not only attributed ones,
  because the platform does its own attribution — carrying the Order's total,
  currency, id, and the customer's hashed email and phone.
- Both carry the **Order id as the event id**, so the platform counts one
  purchase. The server-side one is the one that survives an ad blocker.
- Meta's browser identifiers (`_fbp`, and `_fbc` derived from `fbclid` on
  landing) travel with the cart the way attribution already does, and are frozen
  onto the Order at checkout. They raise match quality substantially and are
  worthless if collected later.
- Dispatch is recorded in its own small table keyed by Order, with a state and
  an attempt count, so a failed send is retried by the hourly job and a
  successful one is never sent twice. Sending must never be able to fail a
  checkout — the same guarantee attribution already has.
- **Refunds are not retracted**, because the platform has no retraction. Our own
  revenue already excludes refunded Orders; the platform's count will drift, and
  that is accepted.
- **Consent**: a per-Store switch, **off by default**. When on, the Starter
  Storefront shows a consent banner, the pixel waits for acceptance, and no
  server-side Purchase is sent for a customer who did not accept — an IP address
  and a hashed email are personal data too.

### What is deleted

Backend:

- `campaign_matching_rules`, `campaign_spend`, `ad_reported_figures`,
  `unlinked_ads` tables, and everything that reads or writes them: the rule
  matcher and normalizer, the rule preview, the spend service and its range
  entry, provenance and pinning, the reported-figure service, the unlinked-ad
  state machine and its controller.
- The `campaign_platform` enum's non-paid values and every code path for them.
- Campaign Tag and Ad Tag derivation, and the tagged-link generator.
- `ayrshare.adapter.ts`.
- The marketing summary endpoint feeding the dashboard spend card.
- The `archived` status and the archive/unarchive paths on Campaign and Ad.

Frontend:

- `campaign-spend-card`, `matching-rules-card`, `rule-preview-panel`,
  `unlinked-ads-panel`, `reported-figures`, `measured-traffic`,
  `tagged-link-card`, `ad-tagged-link`, `performance-table`,
  `campaign-filters`, `campaign-performance-controls`, `performance-summary`,
  `archive-campaign-button`, `ad-platform-state`, the view-mode toggle, and the
  `/admin/campaigns/revenue` redirect.
- The dashboard's `spend-summary` card.

Kept: the attribution snapshot on Cart and Order, the touch rules, the lookback
resolution, the realized-revenue status set, `ca.js`, and the Store-scoped
credential handling.

There is no data migration. The hosted database holds no real campaigns, spend
or reported figures, so tables are dropped and recreated rather than altered.

## Testing Decisions

The existing floor holds: assert where the blast radius is money, tenancy or
attribution, and leave the UI untested.

**The seam is the in-memory fake provider**, swapped at the provider token in
the test app helper exactly as the payment fake already is, with everything else
production wiring against local Postgres. Like that fake, it records what it was
asked for, so a test can assert what the sync requested — and that a create
carried the Link Tags.

**A new end-to-end spec**, from the fake returning a tree, through the real sync
against a real database, to the merchant reading the page through the admin API:

- A first sync backfills history rather than starting from today.
- Running the same sync twice produces the same rows, not doubled ones.
- A campaign the platform reports and we have no row for is inserted, with its
  ads, and reads Not Tracked.
- A campaign whose ads all carry our tags reads Tracked.
- Creating a campaign sends the Link Tags in the same call that creates the ads,
  and stores the platform ids it gets back.
- An Order whose last touch carries a campaign id and an ad id credits that
  Campaign and that Ad.
- An Order whose last touch names no Campaign but whose first touch does credits
  the Campaign — the latest-ad-click rule.
- An Order matching a Campaign but no Ad lands in the campaign total and on the
  "Not linked to an ad" line.
- Ad rows sum to the campaign total, for every figure.
- ROI and margin are withheld when any sold item lacks a cost price, and
  computed when none does.
- ROAS is null, not zero or infinity, at zero spend.
- A provider failure leaves the previous figures readable and surfaces the
  failure, rather than propagating into the read.
- A connection, its campaigns and its figures are unreachable from another
  Organization.
- A paid Order dispatches exactly one Purchase, carries the Order id as the
  event id, and is not dispatched twice when the job runs again.
- A provider failure on dispatch does not fail the checkout and leaves the
  Purchase retryable.

**Pure unit specs** for the parts that fail quietly: decimal-to-minor-units at
boundary values, the currency guard, the five-value status collapse from the
platform's three axes, the latest-ad-click rule, and the tag template builder.

**Do not test that the cron fires.** Invoke the sync method directly.

## Out of Scope

- **Google Ads**, and every other network. Meta only, read and write.
- **Organic posting, post analytics, the comment/DM inbox, boosting an existing
  post.** The vendor sells all of them; none is this stage.
- **Ad sets as a modelled level**, audience editing, bidding, placements,
  lookalikes, catalogs and Advantage+ shopping campaigns.
- **Deleting a campaign or an ad.**
- **Currency conversion.** Forbidden outright; the connection refuses a mismatch
  instead.
- **The platform's reported revenue, conversions and ROAS.** Not stored, not
  shown.
- **Webhooks.** Poll-only.
- **Period-over-period deltas and sparklines.** Still deferred.
- **Non-paid marketing** of any kind.
- **A second attribution model.** Latest ad click, one lookback window.

## Further Notes

**The tags are the whole product.** Every figure on the revenue side of these
screens exists because an ad carried `utm_campaign` and `utm_content` when it
was clicked. If the create path ever ships without writing them, or the retag
button is quietly skipped because re-review is awkward, this stage produces a
page of spend with no revenue beside it — which is worse than what it replaces.
Build the create path tags-first.

**Not Tracked is not zero, and the difference is the point.** The previous design
withheld auto-created ads from the UI because cost without revenue reads as
catastrophic failure. This design shows them and labels the gap instead. Any
place that renders an untracked campaign's revenue as `$0` reintroduces exactly
the bug ADR-0005 was written to avoid.

**The write path spends real money.** Everything that reaches the platform
should be reviewable before it lands: the dry-run before create, the explicit
warning before a retag, Save-as-paused on the form. There is no undo on an ad
that has already delivered.

**Expect our numbers and Meta's to disagree**, and do not try to reconcile them.
Ours count Orders on a 30-day lookback and the latest ad click; Meta counts
conversions on its own window with view-through included. The lookback line in
the footer is the whole of the explanation this product offers, deliberately.
