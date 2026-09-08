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

**Status:** ready-for-agent

- [ ] Attribution resolves in two passes per ADR-0004. The existing Campaign
      matcher runs unchanged and picks the Campaign; a second matcher then picks
      an Ad from `utm_content`, built over that Campaign's own Ads alone
- [ ] **An Ad can never claim a tuple whose `utm_campaign` resolves to a
      different Campaign.** This is the property ADR-0004 was written for, and it
      fails without throwing, so it is exercised exhaustively as a unit rather
      than inferred from the far end of a checkout
- [ ] Two Campaigns each owning an Ad tagged `video-a` resolve independently and
      correctly
- [ ] Both matchers stay pure: no database, no framework, no clock
- [ ] A `utm_content` that normalizes to nothing is Unassigned, not a match —
      absence of evidence is not a match, on the same principle the Campaign
      matcher already applies
- [ ] Both sides of the Ad comparison are normalized, so `Video_A` and `video-a`
      are one Ad
- [ ] An Ad created today claims the Orders its links already produced, because
      resolution happens at read time
- [ ] The report returns a per-Ad breakdown beneath each Campaign line, plus an
      Unassigned line per Campaign
- [ ] Unassigned is always its own visible bucket and is never redistributed
      across the Ads that exist, on the same principle that keeps Unattributed
      visible at the Store level. It is a distinct outcome from Unattributed and
      the two are never folded together
- [ ] Per-Ad figures come from the same read the Campaign report is computed
      from — one calculation and one definition of a period, following the
      precedent the Campaign performance panel already set
- [ ] Per-Ad ROAS and Contribution Margin follow the existing null semantics
      exactly: no ROAS without Spend rather than zero, and no margin without cost
      coverage rather than a fiction
- [ ] Switching between First Touch and Last Touch splits by Ad correctly under
      both, since both Touches carry `utm_content`
- [ ] A Campaign's own totals are unchanged by the split: its Ads' figures plus
      its Unassigned figure reconcile to the Campaign line
- [ ] Money stays in minor units and is never formatted server-side; ROAS stays a
      ratio and never passes through the money formatter
- [ ] A merchant sees the per-Ad split on the Campaign detail page
- [ ] Proven at the full-length seam: a sale arrives through the public
      storefront API carrying `utm_content` alongside its other tags, and the
      merchant reads the money back through the admin API resolved onto the Ad
      that earned it, against figures worked out by hand rather than recomputed
      by the test
- [ ] The storefront pass-through of `utm_content` is verified end to end rather
      than assumed, and per ADR-0001 resolving it can still never fail a checkout
