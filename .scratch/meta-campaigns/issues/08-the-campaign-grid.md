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

**Status:** resolved

- [x] A card shows cover, name, platform, status and attributed revenue for a
      fixed last-30-days window, labelled once on the page
- [x] A Not Tracked campaign shows "Not tracked" in place of a revenue figure
- [x] A campaign with no cover of its own falls back to the creative of the ad
      that spent the most
- [x] The grid holds every campaign that is not Ended, plus those that ended
      inside the window
- [x] Older ended campaigns are reachable behind one quiet link that names how
      many there are
- [x] Order is Active first, then In review, Needs attention and Paused, then
      Ended; within a group, by revenue
- [x] Search filters by campaign name
- [x] A card links to its campaign's detail page
- [x] The header carries the connection summary with its last sync time and a
      Refresh action
- [x] A sync failure is visible here without breaking the page or the figures
      already shown
- [x] A Store with no campaigns yet, but a live connection, says so rather than
      showing an empty page

## Comments

Done. Backend `tsc`, `npm test` (453 unit specs) and `campaign-revenue.e2e-spec.ts`
(28 specs, two new) are green, `eslint` is clean over the backend files
touched, and the frontend build (`vite build && tsc --noEmit`) passes. The UI
itself is untested, per the spec's testing floor. I checked the grid's
membership and ordering with a scratch script, and nothing was run against a
live account.

The grid reads the existing attributed-revenue report at a fixed `30d`
(`GRID_PERIOD` in `features/campaigns/utils.ts`). No new endpoint was added.
The report gained two fields. Both describe the campaign's whole life, not the
period, and both live in `marketing/utils/campaign-card.util.ts` with a unit
spec:

- **`coverUrl` now falls back at read time.** It is the campaign's own cover,
  or else the creative of the ad with the most lifetime spend. The tie-break
  (oldest ad, then id) is the same as the sync's `fillMissingCovers`, so a card
  shows the same picture before and after a sync. The sync still writes the
  cover once. The read-time fallback covers the time before that write lands.
- **`endedAt`** is when an Ended campaign stopped: its scheduled end once
  passed, otherwise the last day any of its ads reported a figure. This covers
  a campaign deleted on Meta, which has no end of its own. An Ended campaign
  that never reported a figure has `endedAt` null and is filed under **older**,
  because it spent nothing in any history this Store holds.

Judgement calls on the page:

- **The middle group is one group.** In review, Needs attention and Paused are
  ranked together by revenue, as the spec's "In review / Needs attention /
  Paused" reads, not as three sub-groups.
- **A Not Tracked campaign sorts after the tracked ones in its group**, by
  name. Its revenue is unknown, so it is ranked neither as a zero nor above
  one.
- **Search filters the older campaigns too**, so "Show older campaigns (N)"
  counts the matches it would reveal.
- **A sync failure shows on the header line itself.** It is amber, with
  "last refresh failed", and the full sentence is still in the panel, so a
  merchant who never opens the panel can still tell stale figures from live
  ones. The grid is drawn from stored figures either way.
- **No Create button.** That is ticket 11's to add.

Removed from the page: the period tabs, the per-ad cards, the "Not linked to
an ad" card, the Unattributed card and the explanatory footer.
`performance-figures.tsx` (`FigureList`) had no remaining users and is
deleted. `CreativeTile` is kept, because the detail page uses it, and now takes
a `className` for the card's full-width cover.

Not done here: the spec's deletion list includes the
`/admin/campaigns/revenue` redirect. That route still exists, and it belongs
to ticket 01's clean-up rather than to this ticket.
