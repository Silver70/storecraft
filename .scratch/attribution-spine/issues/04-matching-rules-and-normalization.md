# 04: Matching rules and normalized matching

**What to build:** A merchant can teach a Campaign to recognise the UTM variants their links actually went out with, so one marketing push tagged inconsistently is still reported as one Campaign.

A rule targets one attribution field — utm_campaign, utm_source, utm_medium, or referrer host — with an operator of `equals` or `starts_with` and a comparison value. Matching normalizes both sides: trimmed, lowercased, with hyphens, underscores and whitespace collapsed to one canonical separator. This is what makes `summer_sale`, `Summer-Sale` and `summer sale` a single Campaign without the merchant writing three rules, and it is the highest-value behaviour in this ticket.

When several rules could match one attribution tuple, resolution is deterministic: a rule on utm_campaign outranks one on utm_source or utm_medium, which outrank one on referrer host; `equals` outranks `starts_with`; remaining ties break by Campaign creation time, oldest first. A tuple matching no rule is Unattributed, which is always its own outcome and never redistributed.

This is the part of the feature that fails silently — a mis-match does not raise an error, it makes a Campaign look unprofitable forever — so the matching decision itself is exercised exhaustively as a pure unit, independent of the database.

**Blocked by:** 03

**Status:** resolved

- [x] A merchant can add and remove matching rules on a Campaign
- [x] Values differing only by hyphen, underscore, whitespace, case or surrounding padding resolve to the same Campaign
- [x] When two rules could both match, the documented precedence decides, and the same tuple always resolves to the same Campaign
- [x] A tuple matching no rule resolves to Unattributed
- [x] An empty rule set resolves to Unattributed rather than erroring
- [x] Matching is covered as a pure unit with no database or framework involved
- [x] Rules are scoped to their Organization and Store and can never match another tenant's traffic

## Comments

Implemented 2026-09-04.

**The matcher is one pure function over a rule set.**
`src/modules/marketing/utils/campaign-matching.util.ts` —
`createCampaignMatcher(rules)` normalizes and orders the rules once and returns
`(tuple) => match | null`. Nothing in it touches a database, a framework, or the
clock, so the 32-case spec beside it drives every decision directly rather than
through a checkout. Pre-sorting rather than sorting per call is for ticket 05,
which will run this over a period's worth of orders.

**Normalization is wider than the ticket's letter, deliberately.** Every run of
non-alphanumerics collapses to one hyphen, not just hyphens, underscores and
whitespace — the same reduction `deriveCampaignTag` performs, so a Campaign's
canonical tag is already in normalized form and `summer.sale` cannot become its
own bucket. Accents fold (`Été` → `ete`, matching the tag), but letters outside
Latin are kept as themselves: stripping them would collapse every non-Latin
campaign onto nothing, and nothing must never match. A value that normalizes to
nothing is null, and null matches nothing — including another null, or every
untagged visit in the store would land on one campaign.

**Precedence is a total order, not a partial one.** Field, then operator, then
campaign creation time, then campaign id and rule value. The last two are not in
the spec: two campaigns created in the same millisecond would otherwise resolve
by whatever order Postgres returned the rows, and a report that moves an order
between campaigns on a re-read is worse than one that picks the wrong campaign
consistently. A spec case permutes a four-rule set through all 24 orderings and
asserts one answer.

**Rules store what the merchant typed, not the normalized form** — the screen
shows their own words back, and normalization happens on both sides at compare
time. The one exception is `referrer_host`, where a pasted
`https://www.instagram.com/p/abc/` is reduced to `instagram.com`, since that is
what the merchant means. Duplicates are refused on *meaning*: adding
`Paid-Social` when `paid_social` exists is a 409 that says why, rather than a
second row that could never win.

**API.** `GET|POST /api/admin/campaigns/:id/rules` and
`DELETE /api/admin/campaigns/:id/rules/:ruleId` (204), under the existing
`campaigns.read` / `campaigns.write` permissions. The canonical rule is refused
with a 409 rather than a 403: it is not a permission problem, it is that every
link already generated from the campaign carries that tag. A value that could
never match anything (`---`, whitespace) is a 400.

**Tenancy is enforced at the load, not in the matcher.**
`CampaignService.buildMatcher(orgId, storeId)` is the only way rules reach the
matcher, and it reads one organization and store. The matcher itself will
faithfully match whatever it is handed — which is why the boundary is asserted
against real rows: two organizations each running "Summer Sale" both get tag
`summer-sale`, and the same tuple resolves to each merchant's own campaign and
never the other's. Archived campaigns are included in the load on purpose:
archiving retires a campaign from the active list, it does not disown the orders
it already explains.

**Admin UI.** A Matching Rules card on the campaign detail page —
`src/features/campaigns/components/matching-rules-card.tsx` — listing the
canonical rule first (locked, with the reason) then the merchant's, with an
add row and per-rule removal. The card states the normalization rule up front
and the precedence rule at the bottom, because a merchant who does not know that
`summer_sale` and `Summer-Sale` are one rule writes three, gets a 409, and has
no idea why.

**Tests.** `campaign-matching.util.spec.ts` (32 tests, seam 2): normalization,
referrer hosts, every field, both operators, all four precedence levels, the
permutation case, and every route to Unattributed including the empty rule set.
`test/admin-campaigns.e2e-spec.ts` gains a `matching rules` block (12 tests,
seam 1) driving the real admin API against local Postgres: add and list, a rule
claiming four spellings of the value the links went out with, a pasted URL
reduced to its host, duplicate-by-meaning and unmatchable values refused, removal
returning traffic to Unattributed, the canonical rule refused, precedence across
two campaigns, and the organization and store boundaries. Matching has no HTTP
surface of its own until ticket 05, so those assertions resolve through
`CampaignService.buildMatcher` over the rows the API actually persisted.

Verified: `npm test` 134 passed (9 suites); `npm run test:e2e` 41 passed (4
suites); `tsc --noEmit` clean and eslint clean on the touched files; frontend
`npm run build` (which runs `tsc --noEmit`) clean.

**No migration.** `campaign_matching_rules` landed with ticket 03, and nothing
here changes the schema.

**Pre-existing lint failures are untouched.** `npm run lint` fails on seven
`@typescript-eslint/unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`, neither of which this ticket touches. Note that the
lint script runs `eslint --fix`, so running it reformats unrelated files.
