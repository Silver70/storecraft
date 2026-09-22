# 12: Edit a campaign

**What to build:** The handful of changes a merchant needs while a campaign is
running: stop it, feed it, extend it, rename it, add a fresh creative, change the
picture it is recognised by.

What is missing is the ticket. Audience and goal are not editable because
changing them resets what the platform has learned. An existing ad's creative is
not editable because the platform replaces the creative and sends the ad back
through review, losing its engagement; the supported move is to add a new ad and
pause the old one. There is no delete, because deletion at the platform cannot be
undone and pausing achieves what the merchant wants.

Every change here spends, or stops spending, real money. Each one takes effect at
the platform and is reflected here immediately, not at the next hourly sync.

**Blocked by:** 09, 11

**Status:** ready-for-agent

- [ ] A merchant renames a campaign, and its reporting is unaffected because the
      join is on platform ids
- [ ] They change the daily budget, in the Store's currency
- [ ] They set or clear the end date
- [ ] They pause and resume the whole campaign
- [ ] They pause and resume a single ad without touching its siblings
- [ ] They add an ad to a running campaign, through the same ad form as creation,
      and it is created carrying its link tags
- [ ] They choose the cover from the campaign's own ads or upload one
- [ ] A campaign whose budget lives per ad set has its budget field disabled,
      saying to change it at the platform
- [ ] Audience, goal and an existing ad's creative are absent from the screen,
      not merely disabled
- [ ] Every change is reflected here as soon as the platform accepts it
- [ ] A rejected change leaves the previous state intact here and reports what
      the platform said
- [ ] Editing requires `campaigns.write`
