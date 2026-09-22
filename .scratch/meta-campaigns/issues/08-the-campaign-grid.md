# 08: The campaign grid

**What to build:** The page the merchant actually asked for. Open Campaigns and
see, at a glance, which campaigns are running and what each one earned. A card
per campaign: its creative, its name, its platform, its status and its revenue.
Nothing else — no summary strip, no filters, no date controls, no explanatory
paragraphs.

Every card reports the same fixed window, stated once at the top, so the cards
can be compared with each other.

A campaign whose ads carry no link tags says **Not tracked**, never `$0`. The
difference is the whole point: one means the campaign earned nothing, the other
means we cannot see what it earned, and showing the second as the first invents
a failure that did not happen.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] A card shows cover, name, platform, status and attributed revenue for a
      fixed last-30-days window, labelled once on the page
- [ ] A Not Tracked campaign shows "Not tracked" in place of a revenue figure
- [ ] A campaign with no cover of its own falls back to the creative of the ad
      that spent the most
- [ ] The grid holds every campaign that is not Ended, plus those that ended
      inside the window
- [ ] Older ended campaigns are reachable behind one quiet link that names how
      many there are
- [ ] Order is Active first, then In review, Needs attention and Paused, then
      Ended; within a group, by revenue
- [ ] Search filters by campaign name
- [ ] A card links to its campaign's detail page
- [ ] The header carries the connection summary with its last sync time and a
      Refresh action
- [ ] A sync failure is visible here without breaking the page or the figures
      already shown
- [ ] A Store with no campaigns yet, but a live connection, says so rather than
      showing an empty page
