# 06: Reported Figures beside ours

**What to build:** The merchant sees both numbers. The platform's spend, revenue
and ROAS sit next to ours on the card, each labelled with where it came from and
the window it was measured over. The two will routinely disagree by a factor of
two, and that difference is the point: today the merchant has one number and no
way to tell a measurement difference from a tracking failure.

Where the ad account bills in a different currency than the Store, the merchant
is told that, rather than shown a figure derived from an invented exchange rate.

**Blocked by:** 03 (Unlinked Ads: claim and dismiss), 04 (Spend provenance and
pinning).

**Status:** ready-for-agent

- [ ] The card shows the platform's spend, reported revenue and reported ROAS
      alongside ours
- [ ] **Every platform figure is labelled with its source.** A Reported Figure
      must never be mistakable for one of ours (ADR-0005)
- [ ] Our Lookback Window is shown beside our figure and the platform's window
      beside theirs, so the merchant can see why they differ
- [ ] **Reported Figures are never merged into our figures**, and never replace
      them where present — that would make a revenue total incomparable with
      itself, since the same period would report differently depending on which
      ads happened to be synced that day
- [ ] **Reported Figures never feed Contribution Margin**, which is computed only
      from Orders whose goods have cost prices. A platform's conversion value has
      no cost basis behind it
- [ ] Where the ad account's currency differs from the Store's, the figure is
      displayed in its own currency and the mismatch is explained
- [ ] **No ROAS and no Contribution Margin is computed across a currency
      mismatch.** The merchant is shown nothing rather than something wrong
- [ ] The additions do not change any of our own figures on the page
- [ ] The card stays readable for an Ad with no Reported Figures at all, which is
      every Ad on a platform no sync covers
- [ ] Covered end to end: both figures come back distinguishable from one read,
      a foreign-currency figure yields no combined ratio, and a Reported Figure
      is proven absent from Contribution Margin
