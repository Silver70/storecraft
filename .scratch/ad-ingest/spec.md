# Ad Ingest

Status: ready-for-agent

Stage 6 of the product roadmap — "stop typing what the ad platform already
knows". Builds on Ad Cards (`.scratch/ad-cards/`) and respects ADR-0001
(attribution snapshot on Order), ADR-0002 (Campaign as a first-class entity),
ADR-0004 (an Ad is nested under its Campaign) and above all **ADR-0005**
(ad-platform figures are stored beside ours, never merged into them).

**Blocked by Stage 5 in its entirety.** An Unlinked Ad needs an Ad to be claimed
onto, and a Reported Figure needs an Ad to sit beside. Building this first would
mean building the claim flow against a table that does not exist.

## Problem Statement

The merchant is a data-entry clerk for a number a computer already holds.

Stage 2 made Spend a first-class record, and Stage 5 made it recordable per Ad.
Both required the merchant to read a figure off an ad platform's dashboard and
type it into ours, one day at a time. Per Campaign that was tedious. Per Ad it
is worse by a factor of however many creatives are running, and the finer the
grain the more valuable the report and the less likely anyone is to keep feeding
it. A report that depends on daily manual entry decays into a report nobody
trusts, because the merchant knows they skipped last Tuesday.

There is a second, quieter problem. The merchant builds an ad in Meta Business
Suite — which is where they already work, and where they will keep working — and
our system has no idea it exists. Money leaves the account and nothing here
records it. The merchant's own dashboard is silently understating what they
spent, and overstating every ROAS on the page as a direct consequence.

Third: when the two systems do both hold a number, they disagree, and nothing
explains why. Meta reports conversions on its own attribution window and its own
view-through rules; we report Orders on a 30-day Lookback Window and a tagged
link. The gap is routinely a factor of two. Today the merchant has one number
and no way to see the other, so they cannot tell a measurement difference from a
tracking failure.

## Solution

Pull what the platform knows, and keep it visibly separate from what we know.

A merchant connects a Store to an ad platform once. From then on a scheduled
sync reads the ad tree and records, per ad and per day, what the platform says
it spent and what the platform says it earned. Those are **Reported Figures**:
stored beside our own figures, always labelled with their source, never merged
into them, and never an input to Contribution Margin — which has no cost basis
behind a platform's conversion value.

Where the sync finds an ad we have no record of, it does **not** invent one. It
holds it as an **Unlinked Ad** for the merchant to claim onto a Campaign or
dismiss. An Ad conjured from a sync would carry real cost and have no way to
earn revenue, because only a link carrying its Ad Tag joins a platform's ad to
our Orders — so an auto-created Ad would appear as the worst performer in the
account, every time. The claim flow is where the product actually lives: _"Meta
is spending on this. Tell me which Campaign it belongs to, and here is the
Tagged Link to make it measurable."_

Spend gains a provenance. A synced figure and a merchant's own entry can both
describe one day; the row records which it is, a sync wins by default, and a day
the merchant corrected by hand is pinned so the next sync does not silently
revert it an hour later.

And the whole thing is disposable. The vendor sits behind an interface, the
manual Spend path stays first-class rather than becoming a migration artifact,
and a sync failure is logged and surfaced on the page rather than thrown into a
merchant's read path. If the vendor disappears, the product degrades to Stage 5
and keeps working.

## User Stories

1. As a merchant, I want to connect my Store to an ad platform once, so that I
   stop typing figures the platform already holds.
2. As a merchant, I want to be taken through the platform's own approval screen,
   so that I am granting access with my own credentials and can see what I am
   approving.
3. As a merchant, I want to come back to my admin when the connection finishes,
   so that the flow ends where it started.
4. As a merchant, I want to see which platforms a Store is connected to, so that
   I know what is and is not being measured for me.
5. As a merchant, I want to disconnect a platform, so that I can revoke access
   without deleting the history it produced.
6. As a merchant, I want the figures already pulled to survive a disconnect, so
   that revoking access does not rewrite my past reports.
7. As a merchant with several Stores, I want each Store connected separately, so
   that a US store and a UK store never share an ad account or a currency.
8. As a merchant, I want a connection to belong to my Organization alone, so
   that no other tenant can read or reach my ad account.
9. As a merchant, I want history pulled when I first connect, so that the
   feature is useful on day one rather than in a month.
10. As a merchant, I want the sync to run on its own, so that keeping the report
    current is not a task I have to remember.
11. As a merchant, I want to see when the last successful sync ran, so that I
    know how current the figures on the page are.
12. As a merchant, I want a failed sync to be visible, so that I do not read a
    stale number as a fresh one.
13. As a merchant, I want a failed sync never to break the page, so that a
    vendor outage costs me freshness and not my dashboard.
14. As a merchant, I want to trigger a sync by hand, so that I can refresh
    figures without waiting for the schedule.
15. As a merchant, I want the platform's spend recorded per ad per day, so that
    it lines up with the grain my Ads already use.
16. As a merchant, I want the platform's own impressions, clicks and conversions
    alongside its spend, so that I can see whether a weak Ad was unseen or
    unpersuasive.
17. As a merchant, I want the platform's own reported revenue and ROAS shown
    next to ours, so that I can judge the gap myself.
18. As a merchant, I want every platform figure labelled with its source, so
    that I never mistake it for one of ours.
19. As a merchant, I want the Lookback Window shown beside our figure and the
    platform's window beside theirs, so that I can see why they differ.
20. As a merchant, I want platform figures excluded from Contribution Margin, so
    that a margin is never computed from revenue with no cost basis behind it.
21. As a merchant, I want a platform figure in a different currency stored as
    what it is, so that no invented exchange rate ends up inside my margin.
22. As a merchant, I want no ROAS or margin computed across a currency mismatch,
    so that I am shown nothing rather than something wrong.
23. As a merchant, I want to be told when my ad account's currency differs from
    my Store's, so that I understand why a figure is not being combined.
24. As a merchant, I want an ad the platform is spending on that I have no
    record of to be held for me, so that money leaving my account is never
    invisible.
25. As a merchant, I want an unlinked ad never to become an Ad on its own, so
    that my card grid is not filled with creatives showing cost and no revenue.
26. As a merchant, I want to see how much an unlinked ad has spent, so that I
    can judge whether it is worth claiming.
27. As a merchant, I want to see the unlinked ad's creative and name, so that I
    can recognise which of my ads it is.
28. As a merchant, I want to claim an unlinked ad onto an existing Campaign as a
    new Ad, so that its spend starts counting against the right push.
29. As a merchant, I want to claim an unlinked ad onto an existing Ad, so that a
    creative I already created here is matched to the one running there.
30. As a merchant, I want the Tagged Link offered to me the moment I claim, so
    that I know exactly what to paste into the platform to make it measurable.
31. As a merchant, I want to dismiss an unlinked ad, so that ads I do not want
    tracked stop asking to be dealt with.
32. As a merchant, I want a dismissed ad to stay dismissed across syncs, so that
    the list does not refill with things I already decided about.
33. As a merchant, I want to see how many unlinked ads are waiting, so that I
    know there is something to deal with without going looking.
34. As a merchant, I want a claimed ad's history to come with it, so that
    claiming does not start its spend from zero.
35. As a merchant, I want my hand-entered Spend and a synced figure to be
    distinguishable, so that I can tell what I typed from what was pulled.
36. As a merchant, I want a synced figure to take precedence by default, so that
    I am not maintaining two sets of books.
37. As a merchant, I want a day I corrected by hand to stay corrected, so that
    reconciling against an invoice is not silently reverted an hour later.
38. As a merchant, I want to un-pin a day I corrected, so that I can hand it back
    to the sync when I change my mind.
39. As a merchant, I want to keep entering Spend by hand for platforms that
    cannot be synced, so that email, SMS, affiliate and influencer Campaigns are
    still costed.
40. As a merchant, I want to see what the platform says an Ad is doing right
    now, so that I learn an ad was rejected from my own dashboard.
41. As a merchant, I want the platform's state never to overwrite my own Ad's
    status, so that an ad paused at the platform does not vanish from my active
    list along with its history.
42. As a merchant, I want to see an Ad that is Active here and rejected there,
    so that I find out why a Campaign stopped producing.
43. As a merchant, I want to see which placement an ad ran in, so that I can
    recognise it the way the platform names it.
44. As a merchant, I want the sync never to create, change or spend money on an
    ad, so that connecting a read-only integration cannot cost me anything.

## Implementation Decisions

### The provider seam

One new interface — an ad-platform provider — with the vendor's adapter behind
it, following the `PaymentProvider` precedent exactly. It is the second
collaborator in this codebase that would otherwise reach a third party over the
network, and it sits behind an interface precisely so it can be swapped.

**The interface is vendor-neutral; the vendor's name appears only in the
adapter.** ADR-0005 and the Stage 5/6 split both rest on this integration being
disposable, and a vendor name leaking into the domain would make it permanent.

The provider exposes what this stage needs and nothing more: begin a connection,
complete one, list the ad tree with its daily metrics for a date range, and
report its own health. **There is no method that creates, boosts, edits, pauses
or budgets an ad.** Mirror-only was the decision; the absence of a write method
is what enforces it.

### Connecting

The platform's own hosted approval and account-selection screens are used. Our
admin starts the flow, the merchant approves on the platform, and they land back
in our admin. We do not build a per-platform account picker.

One vendor profile per **Store**, not per Organization: Campaigns and currency
are both Store-scoped, so an Organization with a US store and a UK store must not
share a bucket. Profiles cost nothing, so the finer grain is free.

**Issue a scoped credential per Store rather than using one credential
everywhere.** The vendor's own documentation warns that its posting endpoint
accepts any account id the team owns regardless of profile — the inverse of the
`TenantScopedRepository` guarantee this codebase holds everywhere else. Treat
this as defence in depth, not throughput: a scoped key adds no rate limit.

Credentials are secrets and are stored as such, never returned by any read, and
never logged.

On first connection, backfill the history the platform offers rather than
starting from today.

### Sync

**Poll-only. No webhook endpoint is built in this stage.** No webhook pushes ad
spend — metrics are pull-only — and the events we might otherwise want are all
obtainable from the next poll. Standing up signature verification, at-least-once
dedupe and a dead-letter path for a vendor we have decided we can lose is
surface we do not need.

A scheduled job pulls the ad tree per connected Store, using `@Cron` and
`ScheduleModule` as the existing reservation-expiry, low-stock and analytics
rollup jobs already do. The sync method is a plain public method the schedule
calls, so it is invocable directly.

The sync is **idempotent**: running it twice over the same range produces the
same rows, not doubled ones.

Upstream quotas on some platforms are shared across all of the vendor's
customers and cannot be bought out of. Back off rather than retry hard, and
never let a customer-facing read block on a call that may be quota-refused.

**A sync failure is logged and surfaced on the page. It is never thrown into a
merchant's read path.** The last successful sync time is recorded per connection
and displayed, so a stale figure is legibly stale.

### Reported Figures

Their own daily records, per ad per day: the platform's spend, impressions,
clicks, conversions, its own reported revenue and its own ROAS, with the source
and the currency denormalized onto the row.

**Never written into `campaign_spend`.** That table is the merchant's book of
record; this one is the platform's. They are displayed side by side and labelled,
per ADR-0005.

**Money crosses the boundary as a float and must not stay one.** The vendor
reports decimal amounts (and whole currency units for budgets) against this
codebase's integers-only rule. Convert to minor units in the adapter, at the
edge, with an explicit and tested rounding rule. No float reaches a service, a
repository or a report.

**No currency conversion, anywhere.** A figure in a currency other than the
Store's is stored as what it is. No ROAS and no Contribution Margin is computed
across a mismatch — the merchant is shown the mismatch instead of a number
derived from an invented rate. This is ADR-0005's sharpest constraint and the
one most likely to be "fixed" by a future reader.

**Reported Figures never feed Contribution Margin**, which is computed only from
Orders whose goods have cost prices.

### Unlinked Ads

An ad the platform is spending on that no Ad in the Store claims. Held in a
review list, carrying its platform id, name, creative, flight dates and spend to
date.

**Never auto-created as an Ad.** An Ad invented from a sync has cost and no
`utm_content` rule, so it would show real spend against zero revenue and read as
a catastrophic loser — auto-generating the most alarming card in the UI.

Claiming resolves an Unlinked Ad onto a Campaign (creating an Ad) or onto an
existing Ad (recording its external id). The claim response offers the Ad's
Tagged Link, because the merchant's next action is to paste it into the
platform.

Dismissal is durable: a dismissed ad does not return on the next sync.

A claimed ad's Reported Figures, including backfilled history, attach to the Ad
it was claimed onto.

### Spend provenance

Spend rows gain a source and a pinned flag. A synced figure overwrites an
unpinned row for the same day; a pinned row is never overwritten, and the sync
records that it declined rather than failing.

The day-uniqueness guarantee established in Stage 5 is unchanged and must not
regress: at most one Campaign-level row per day and one row per Ad per day, with
NULLs handled explicitly.

Manual entry stays a first-class path for every platform, not a legacy one. It
is the entire reason a vendor loss degrades rather than blanks the dashboard,
and it is the only path for `email`, `sms`, `affiliate` and `influencer`
Campaigns.

### Platform State and Placement

Both are nullable fields on the Ad, written only by the sync.

**Platform State never overwrites an Ad's own status.** They are two independent
facts displayed together: an Ad that is Active here and rejected there is the
card that saves a merchant a week, and it only exists if neither value is
allowed to clobber the other. An ad paused at the platform must not disappear
from the merchant's active list.

Placement is a recognition label only — not a dimension anything is reported by,
because one ad runs in several at once.

### Admin API and UI

REST under the admin surface, protected by the admin JWT and RBAC, tenant-scoped
like everything else. The card grid built in Stage 5 gains the platform's
figures beside ours, the Platform State beside the status, and the placement
badge. The Unlinked Ad count is surfaced where the merchant will see it without
going looking.

## Testing Decisions

A good test here asserts what the merchant ends up able to read, not how the
adapter parsed a payload. Assert against figures worked out by hand, and treat
the fake provider as a source of scenarios rather than a recording of real
traffic.

**One new seam**, at the network boundary, shaped like the only other one in the
codebase: an in-memory fake provider swapped in via `overrideProvider` in the
test app helper, exactly as the payment provider fake already is. Everything
else stays production wiring against a local Postgres database. Like that fake,
it records what it was asked for, so a test can assert the sync requested the
range it should have — and, more importantly, that it never asked for a write.

**A new end-to-end spec for the sync.** The seam runs from the fake provider
returning a tree, through the real sync against a real database, to the merchant
reading the result back through the admin API. Asserted there:

- A first sync backfills history rather than starting from today
- Running the same sync twice produces the same rows, not doubled ones
- An ad with no matching Ad becomes an Unlinked Ad and **no Ad is created**
- Claiming an Unlinked Ad attaches its history, including backfilled days
- A dismissed ad does not return on the next sync
- A synced figure overwrites an unpinned Spend day
- **A pinned Spend day survives a sync** — the failure this design exists to
  prevent
- A figure in a foreign currency is stored as that currency, and no ROAS or
  margin is computed across the mismatch
- Reported Figures never appear inside Contribution Margin
- Platform State lands on the Ad without changing its status, and an Ad Active
  here and rejected there is readable as both
- A provider failure leaves the previous figures readable and surfaces the
  failure, rather than propagating into the merchant's read
- Tenancy: a connection and its figures are unreachable from another
  Organization

**Extend the existing Spend spec** for the interaction between hand entry and
provenance, and to prove Stage 5's day-uniqueness guarantee has not regressed.

**Pure unit specs** for the parts that are pure and fail quietly: float to minor
units with its rounding rule at boundary values, the currency guard, and the
mapping from a platform tree onto Campaigns, Ads and Unlinked Ads. Prior art is
the existing marketing utils, which are pure for the same stated reason —
matching and money both fail without throwing.

**The frontend is not tested**, holding the existing floor. The correctness that
matters is asserted at the seams above.

There is no prior art for testing a scheduled job here; the existing cron jobs
are untested. Invoke the sync method directly. **Do not test that the schedule
fires** — that is the framework's behaviour, not ours.

## Out of Scope

- **Creating, boosting, editing, pausing or budgeting ads.** Mirror-only. The
  provider interface has no write method, and adding one is a separate decision.
- **Webhooks.** Poll-only this stage, for the reasons above.
- **A headless account picker.** The platform's hosted selection screen is used.
- **Currency conversion**, exchange rates, or any cross-currency arithmetic.
  Explicitly forbidden by ADR-0005.
- **Audience, targeting, conversion-uploads, lead forms, catalogs, keyword
  tooling** and everything else the vendor offers beyond reading the ad tree.
  The interface stays as narrow as the stage needs.
- **Organic social posting, inbox, messaging and telephony**, which the vendor
  also sells. Not this product.
- **Period-over-period deltas and the traffic sparkline**, still deferred from
  Stage 5.
- **Placement as a reporting dimension.** A recognition label only.
- **Replacing manual Spend entry.** It stays first-class permanently.
- **Making Reported Figures authoritative.** ADR-0005 rejected trusting the
  platform where present, because it makes a revenue total incomparable with
  itself.

## Further Notes

**The vendor is the risk, not the capability.** The research found a capable and
well-documented API — and a company of about eight people, bootstrapped, whose
ads product is months old and whose status page could not be read to verify any
uptime history. That is why this stage is read-only, behind an interface, with
the manual path intact and failures surfaced rather than thrown. The design
assumption is not that the vendor will fail; it is that we should not care much
if it does. Every decision in this spec that looks over-cautious is paying that
premium deliberately.

**This stage buys the cost side and not the revenue side.** The sync can tell
you an ad spent $2,675. Only a link carrying the Ad Tag can tell you what that
ad sold. A merchant who connects a platform and never tags `utm_content` gets
per-Ad spend against Unassigned revenue — cost with no return, on every card.
The claim flow's job is to make that ask legible at exactly the moment the
merchant is looking at the ad in question. If the claim flow is built as a
tidy-up queue rather than as a prompt to tag, this stage will make the dashboard
worse rather than better.

**Two integration foot-guns worth naming before anyone hits them.** The vendor's
posting endpoint ignores profile boundaries by its own documentation, which is
why per-Store scoped credentials are mandatory rather than tidy. And some
upstream quotas are shared across every one of the vendor's customers and cannot
be bought out of, which means a sync can be refused for reasons that have
nothing to do with this Organization — so the failure message a merchant sees
must not blame their own account.

**Expect the numbers to disagree, loudly.** Ours and the platform's routinely
differ by a factor of two, and the whole point of showing both is that the
difference is information. Resist any pressure to reconcile them into one figure:
that pressure will come, and ADR-0005 exists to answer it.
