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

**Status:** ready-for-agent

- [ ] The header shows name, status, platform, the campaign's schedule and a
      period picker offering 7, 30 and 90 days and Lifetime
- [ ] The period defaults to 30 days, or to Lifetime when the campaign has Ended
- [ ] The panel shows attributed revenue, spend, impressions, orders,
      conversion rate and ROI, with clicks and ROAS beneath
- [ ] ROI and Contribution Margin are absent, with a route to add cost prices,
      whenever any item sold in the period lacks one
- [ ] ROAS is absent rather than zero or infinite when spend is zero
- [ ] The lookback window is stated once, in the footer, and nowhere else
- [ ] The ads table lists thumbnail, name, format, status, spend, impressions,
      clicks, orders, revenue and ROAS, with a campaign total row
- [ ] The ad rows and the total agree, for every figure
- [ ] A muted "Not linked to an ad" row appears only when some of the campaign's
      revenue named no ad
- [ ] A Not Tracked campaign shows its spend and says its revenue is not
      tracked, rather than showing zero
- [ ] An ad that is Active here and rejected at the platform is readable as both
- [ ] The page renders from figures already stored, never by calling the vendor
      in the request
