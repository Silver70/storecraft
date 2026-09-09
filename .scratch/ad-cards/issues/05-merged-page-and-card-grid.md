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

**Status:** resolved

- [x] `/admin/campaigns` and `/admin/campaigns/revenue` are one page;
      `/revenue` redirects rather than 404s, because links to it exist
- [x] The page shows a card per Campaign and per Ad, carrying the creative, the
      flight dates, the platform, the status, and the name
- [x] Each card carries attributed revenue, purchases, Spend, ROAS, and
      Contribution Margin with its cost coverage
- [x] The Lookback Window is displayed next to any ROAS, because a different
      window is why these figures differ from an ad platform's
- [x] The existing null states are respected exactly: no ROAS without Spend, no
      margin without cost coverage, losses shown with their sign
- [x] A Campaign's Unassigned revenue is visible on the page, prominent rather
      than tidy — an untagged Ad shows as cost against Unassigned revenue, and
      the merchant has to be able to see that is what happened
- [x] An Ad that spent money and earned nothing appears on the page. The most
      actionable fact in an ad account must not be the one thing hidden
- [x] One period selector and one touch selector govern the whole page, reusing
      the controls already extracted rather than introducing a second set. Two
      figures on screen are never from two different windows
- [x] A view toggle switches the grid to a dense table, and the choice persists
      across navigations
- [x] A merchant can filter by Campaign, platform and status, and sort the list
- [x] A Campaign with no Ads renders unremarkably rather than as an incomplete
      thing needing setup
- [x] An Ad's Tagged Link is one action away from the Ad that needs it, carrying
      both the Campaign Tag and the Ad Tag, so a link pasted into a platform is
      attributed at both levels by construction
- [x] Follows the feature-first convention already in use: thin routes, feature
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

## Comments

Implemented 2026-09-09.

**The join is the design decision.** The page reads two things — the campaign
list and the attributed-revenue report — and `performance-rows.ts` joins them
into one list that both the card grid and the dense table render. The join is
driven by the *campaign list*, not the report: the report deliberately omits an
archived campaign that neither earned nor spent in the window, and this is the
page a merchant manages campaigns from, so it has to be there. Such a campaign
carries a null line and renders as "no revenue and no spend in this period" —
never a row of zeroes. A zero is a claim about a period, and the report did not
make one.

Everything a card shows about an ad now arrives on the report's own ad lines.
`AdRevenueLine` gained `creativeUrl`, `startsAt` and `endsAt` — the field 04
explicitly left for this ticket — so a card is one read. Fetching the ads
separately would have produced a card whose picture and figures came from two
requests that were free to disagree about which creatives exist.

**Unassigned is a card, not a footnote.** It sits in the grid beside the ads it
is the residue of, and goes amber when it holds spend or a quarter of the
campaign's revenue, with a line saying what that means: an ad that looks like it
earned nothing plus revenue piled up here is an untagged link, not a failed
creative. That is the one failure mode per-ad reporting has that has no other
symptom, which is why the Tagged Link is a popover on the ad card itself —
neither tag is typed, so a link built there is attributed at both levels by
construction. A campaign with no ads shows no unassigned card at all: without a
split it would just be the campaign line again, and an empty grid with a nag
would make an optional subdivision look like unfinished setup.

**One period, one touch, one transition.** Both selectors re-key the report
query, and both changes run inside `startTransition`, so switching a period
dims the figures rather than dropping the page to the route's Suspense
fallback. The controls are the ones 02 extracted; no second set was introduced.

**Sorting and filtering are the campaign's, not the ad's.** Nulls sort last on
every measure — absence is not a low score — and spend breaks every tie before
order count, which is the backend's own rule: among the lines that earned
nothing, the ones burning money sort above the ones that are merely idle.
Status filters campaigns and never ads, because an archived ad that spent money
in the period is exactly what must not be hidden. Naming a single campaign
overrides the status and platform filters instead of intersecting with them —
otherwise "show me this campaign" answers with an empty page whenever the one
picked happens to be archived, and nothing on screen says why.

**The view toggle is remembered in a module variable as well as in storage.**
Storage alone cannot be read during the first client render without disagreeing
with the server's HTML, and state alone is lost on every navigation — including
the one a merchant makes most, into a campaign and back. The module variable is
what makes the second and every later mount pick the choice up with no flash.

**Nothing about how a figure is computed changed.** The only backend edit is
three identity fields on the ad line. `formatRoas`, `formatDay`, `formatFlight`
and `coverageNote` moved into `features/campaigns/utils.ts` rather than being
copied a fourth time, and the two components that had their own copies now
import them — the null semantics are the substance of this report and must not
be free to drift per component.

**Coverage.** `ad-revenue.e2e-spec.ts` gains one case at the existing seam: an
ad's line carries the URL of the object the upload actually stored and its
flight dates, and an ad with neither reports nulls rather than a placeholder the
admin would have to decode. The frontend is untested, holding the floor the spec
set. Full backend e2e is green apart from the pre-existing `inline-edit`
failure 04 already recorded.

**Not done here, and deliberately.** No period-over-period deltas, no traffic
sparkline, no visitors or conversion rate — 06 owns the last of those and the
first two need reads that exist nowhere yet. The card grid is built so adding a
demoted, measured-reliability pair to `FigureList` is the whole of that change.
