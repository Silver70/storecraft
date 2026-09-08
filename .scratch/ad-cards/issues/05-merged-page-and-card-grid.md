# 05: The merged page and the card grid

**What to build:** One page for managing and measuring Campaigns and their Ads.
Today `/admin/campaigns` lists managed objects and `/admin/campaigns/revenue`
reports on them, so performance lives somewhere other than the thing it
describes, with its own period selector. They become one page: a grid of cards,
each carrying the creative, the flight dates, the platform, the status, and the
figures that are already being computed.

A dense table stays available behind a toggle, because a card grid does not
scale to forty Ads and the bookstore will have forty Ads.

**Blocked by:** 03 (Revenue splits by Ad), 04 (Ad creative).

**Status:** ready-for-agent

- [ ] `/admin/campaigns` and `/admin/campaigns/revenue` are one page;
      `/revenue` redirects rather than 404s, because links to it exist
- [ ] The page shows a card per Campaign and per Ad, carrying the creative, the
      flight dates, the platform, the status, and the name
- [ ] Each card carries attributed revenue, purchases, Spend, ROAS, and
      Contribution Margin with its cost coverage
- [ ] The Lookback Window is displayed next to any ROAS, because a different
      window is why these figures differ from an ad platform's
- [ ] The existing null states are respected exactly: no ROAS without Spend, no
      margin without cost coverage, losses shown with their sign
- [ ] A Campaign's Unassigned revenue is visible on the page, prominent rather
      than tidy — an untagged Ad shows as cost against Unassigned revenue, and
      the merchant has to be able to see that is what happened
- [ ] An Ad that spent money and earned nothing appears on the page. The most
      actionable fact in an ad account must not be the one thing hidden
- [ ] One period selector and one touch selector govern the whole page, reusing
      the controls already extracted rather than introducing a second set. Two
      figures on screen are never from two different windows
- [ ] A view toggle switches the grid to a dense table, and the choice persists
      across navigations
- [ ] A merchant can filter by Campaign, platform and status, and sort the list
- [ ] A Campaign with no Ads renders unremarkably rather than as an incomplete
      thing needing setup
- [ ] An Ad's Tagged Link is one action away from the Ad that needs it, carrying
      both the Campaign Tag and the Ad Tag, so a link pasted into a platform is
      attributed at both levels by construction
- [ ] Follows the feature-first convention already in use: thin routes, feature
      directory

## Scope fence

This ticket is a **presentation** change over figures that already exist. It
introduces no new measurement. Anything below is out of scope here and must not
be smuggled in:

- No new metrics on the card beyond what 02, 03 and 04 already produce
- No period-over-period deltas (the `↑18.4%` on the mockup) — separate ticket,
  and it needs a comparison read that exists nowhere in the codebase
- No traffic sparkline — separate ticket, and it needs a rollup change or it
  dies at the retention purge
- No visitors or conversion rate — that is ticket 06
- No redesign of admin pages other than the two being merged
- No new component library, design-system refactor, or restyling of shared
  primitives
- No change to how any figure is computed. If a number looks wrong on the card,
  that is a bug in 02 or 03, and it is fixed there
