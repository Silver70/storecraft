---
status: accepted
---

# Campaigns are the ad platform's campaigns, managed through one vendor

A Campaign used to be our own record — a name, a Campaign Tag and matching rules
— with the ad platform behind a wall we only ever read through. It is now one
campaign on one connected Meta ad account: created here and pushed to Meta, or
created in Meta's own ad manager and discovered by a sync. Orders join to it on
Meta's own campaign and ad ids, carried in the Link Tags written onto every ad
we create. One vendor, Zernio, holds the platform registrations and is the only
path to them. There is no manual fallback.

Supersedes ADR-0002 (Campaign as our own record with matching rules), ADR-0004
(Ads resolved by our own Ad Tags in a second pass) and ADR-0005 (platform
figures stored beside ours, with manual Spend first-class).

## Considered options

**Keeping the manual spine as a fallback**, which is what ADR-0005 exists to
justify, was rejected because the fallback is what made the product bad. Every
figure was only as fresh as the merchant's last data-entry session; the merchant
knows they skipped Tuesday, so nobody trusts the report. It also doubles the
domain permanently: two shapes of Spend, a provenance flag, a pinning rule, and
a claim queue for ads nobody typed. The exposure that buys is smaller than it
looks — the join key is Meta's own ids, not something only the vendor knows, so
a later move to Meta's API directly keeps every row already collected.

**Matching rules over merchant-typed tags**, versus platform ids. Rejected:
tags are typed by hand into an ad platform, have to stay unique, and are exactly
what a merchant forgets. Meta fills `{{campaign.id}}` and `{{ad.id}}` in at
click time, they survive a rename, and they exist for every ad including the
ones we did not create. The price is that a UTM string in someone else's
analytics reads `utm_campaign=120250000000000000` instead of a name.

**Mirror only, never create**, ADR-0005's position and the premise of the whole
ad-ingest stage. Rejected because it leaves the merchant working in two tools,
and because it forfeits the one thing that makes per-ad revenue automatic: an ad
we create carries its Link Tags from birth, so it is measurable before it has
ever been seen. Writing is also what makes the vendor load-bearing; that is
accepted deliberately rather than hedged.

**Storing the platform's own revenue, conversions and ROAS beside ours** was
rejected now that only one revenue number is shown anywhere. Two revenue figures
on one page, each on its own attribution window, was the single largest source
of the clutter this redesign exists to remove. Spend, impressions and clicks are
still the platform's, still labelled as its measurements, and are the only
figures of its we keep.

## Consequences

- **Attribution is exactly as good as the tags.** Every ad created here carries
  them. A discovered ad does not, so its Campaign reads **Not Tracked** rather
  than $0, until the merchant asks for tags to be written — which Meta treats as
  a new creative and puts back through review. Revenue that cannot be measured
  is reported as unknown, never as zero.
- **Credit follows the latest ad click** — the last touch if it names a
  Campaign, otherwise the first — so an untagged return visit, such as a search
  for the store's name, does not cancel an ad's credit.
- **The write path spends the merchant's money.** Only rename, budget, end date,
  pause, resume and add-an-ad are exposed. There is no delete, and no editing of
  audience, goal or an existing ad's creative, because each of those either
  cannot be undone or resets Meta's learning.
- **Purchases now leave the system.** Every paid Order is reported to Meta twice,
  from the browser and from the server, deduplicated by the Order id. A refund is
  never retracted, because Meta has no retraction — one more reason its
  conversion counts are not shown beside ours.
- **Losing the vendor** costs the create/edit path and the sync. It does not cost
  the history, which is stored here per Ad per day, nor the join, which is
  Meta's own ids.
- **Non-paid marketing has no home.** Email, SMS, affiliate and influencer
  campaigns are not modelled at all. The Touches that traffic leaves are still
  snapshotted on every Order under ADR-0001, so the capability is recoverable,
  but nothing reports on it today.
