# 09: The campaign detail page

**What to build:** The second screen: the campaign's cover, one performance
panel, and the ads that ran underneath it, one row each. A merchant should be
able to answer "was this worth it, and which creative carried it" without
touching a control.

Two figures need care. **ROI** is withheld entirely unless every item sold in the
period has a cost price — a confident "100%" that secretly covers half the
revenue is worse than no number, so the panel shows a dash and offers to fix the
cause. **Conversion rate** is our Orders over the platform's clicks, which is
two sources in one ratio and is labelled as such.

**Blocked by:** 07

**Status:** resolved

- [x] The header shows name, status, platform, the campaign's schedule and a
      period picker offering 7, 30 and 90 days and Lifetime
- [x] The period defaults to 30 days, or to Lifetime when the campaign has Ended
- [x] The panel shows attributed revenue, spend, impressions, orders,
      conversion rate and ROI, with clicks and ROAS beneath
- [x] ROI and Contribution Margin are absent, with a route to add cost prices,
      whenever any item sold in the period lacks one
- [x] ROAS is absent rather than zero or infinite when spend is zero
- [x] The lookback window is stated once, in the footer, and nowhere else
- [x] The ads table lists thumbnail, name, format, status, spend, impressions,
      clicks, orders, revenue and ROAS, with a campaign total row
- [x] The ad rows and the total agree, for every figure
- [x] A muted "Not linked to an ad" row appears only when some of the campaign's
      revenue named no ad
- [x] A Not Tracked campaign shows its spend and says its revenue is not
      tracked, rather than showing zero
- [x] An ad that is Active here and rejected at the platform is readable as both
- [x] The page renders from figures already stored, never by calling the vendor
      in the request

## Comments

Done. Backend `tsc`, `npm test` (469 unit specs, 16 new in
`campaign-performance.util.spec.ts`), `campaign-revenue.e2e-spec.ts` (11 new)
and `ad-platform-sync.e2e-spec.ts` (1 new) are green, `eslint` is clean over the
backend files touched, and the frontend build (`vite build && tsc --noEmit`)
passes. The UI itself is untested, per the spec's testing floor. Nothing was run
against a live account. The full e2e run has one failure,
`inline-edit.e2e-spec.ts` (`canEditContent` in the config response). It fails
the same way on the untouched tree, so it is not from this ticket.

**One new endpoint:** `GET /api/admin/marketing/campaigns/:id/performance?period=7d|30d|90d|lifetime`
(`AttributedRevenueService.forCampaign`). It returns the same campaign line the
grid's report builds (`campaignLineFor`, now shared by both), plus `roas`,
`conversionRate`, `contributionMargin`, `roi` and `uncostedProducts` on the
campaign and `roas` on each ad. It reads only stored rows. The e2e proves this
by answering with the fake provider set to fail on every call. Only orders
whose first or last touch carries the campaign's platform id are loaded, but
they are credited against the whole Store's index, so an order won by a sibling
campaign's last touch stays the sibling's. The separate ads endpoint is no
longer used by the page, so its frontend query and server fn were removed. The
backend route stays.

**Lifetime** is a campaign-only period (`CAMPAIGN_PERIODS`). The Store-wide
report's periods are unchanged, so no read ever loads a whole Store's history.

**One column:** `ads.review_status` (migration 0030), written by the sync from
the platform's review signal as reported, null included. This is how "Active
here and rejected at the platform" is read. The collapsed status is still the
badge. A rejection or an issues flag is named beneath it ("Rejected by Meta"),
so an ad paused after a rejection reads as both.

Judgement calls:

- **Discounts are not subtracted twice.** CONTEXT.md defines margin as revenue
  − cost of goods − discounts − spend. But attributed revenue is the order
  total, and checkout already nets the discount out of it. So margin is
  revenue − COGS − spend here, and CONTEXT.md now says so. Tax and shipping stay
  inside revenue, as they do in every attributed figure. Change this in
  `campaign-performance.util.ts` if margin should be on merchandise only.
- **"Every item sold in the period"** means the items on the orders credited to
  this campaign in the period, not every order in the Store. Cost is today's
  variant cost price, as in the analytics profit report, because line items do
  not snapshot it. An item whose variant was deleted counts as uncosted. It
  cannot be fixed, so the panel names it instead of linking to it.
- **The route to the fix** goes to the one product missing a cost price, or to
  the product list when several are missing.
- **Not Tracked** withholds everything built on revenue: revenue, orders,
  ROAS, conversion rate, margin and ROI. It still shows spend, impressions and
  clicks. An ad that carries tags inside a Not Tracked campaign still shows its
  own revenue and ROAS, and the total row shows a dash for revenue.
- **ROI at zero spend is absent** as well as ROAS. Contribution margin is still
  shown, under ROI, whenever it can be computed.
- **The period is in the URL** (`?period=`), and the default is left out, so a
  shared link to an Ended campaign still opens on Lifetime.
- **No Edit button** in the header. That belongs to ticket 12.
