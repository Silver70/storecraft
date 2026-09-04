# 09: Matching-rule preview

**What to build:** Before saving a matching rule, the merchant can see which existing Orders it would claim, so an over-broad rule is caught before it reshapes reports rather than after.

Because Campaigns resolve at read time, a saved rule immediately changes historical figures. That is the property that lets a correction repair the past, and it is also what makes a careless rule quietly rewrite it. The preview makes the consequence visible at the moment of authoring: the merchant sees the Orders and the revenue a candidate rule would pull in, and can tell a precise rule from one that swallows everything.

**Blocked by:** 04, 05

**Status:** resolved

- [x] A merchant can preview a candidate rule before saving it
- [x] The preview reports the Orders and revenue the rule would claim for a period
- [x] The preview shows Orders that another Campaign's rule already claims, so overlaps are visible
- [x] Previewing changes nothing — no rule is created and no report is altered
- [x] Saving the previewed rule produces the figures the preview showed
- [x] The preview is scoped to the merchant's own Organization and Store

## Comments

Implemented 2026-09-04.

**The preview runs the real matcher twice rather than describing what it would
do.** `src/modules/marketing/utils/rule-preview.util.ts` —
`previewMatchingRule` builds one matcher over the Store's saved rules and one
over those rules plus the candidate, then compares the two verdicts per Order
through the same `campaignCreditFor` the revenue report uses. Nothing about
matching, the Lookback Window or the bot exclusion is re-implemented here. That
is the whole reason "saving this produces what you were shown" is true rather
than merely intended: there is no second definition of a match to drift from
the one that counts.

**Three outcomes, because two would hide the interesting one.** An Order the
rule wins is *claimed* — split into what was Unattributed and what another
Campaign currently reports, which are very different things to do to someone's
numbers. An Order the candidate matches but loses to a higher-precedence rule is
*blocked*, reported against the Campaign that keeps it. Everything else is
untouched. Blocked is what stops a merchant staring at a broad rule that claims
four orders and having no idea why it is not forty.

**A rule can only ever add matches, and the preview says so.** The matcher
returns the first rule in precedence order, so a new rule changes an Order's
verdict only by winning it — an Order therefore ends up either where it already
was or on the candidate's Campaign. `campaignAfter` can consequently never be
smaller than `campaignBefore`, which is asserted as an invariant rather than
left as folklore.

**The candidate is prepared exactly as saving prepares it.**
`prepareRuleValue` moved out of `CampaignService`'s privates and is now shared
with the preview, so a pasted `https://www.instagram.com/p/abc/` previews as the
`instagram.com` it will actually be stored as, and a value that could never
match (`---`) is the same 400 in both places. The response echoes the stored
value *and* its normalized form, because a preview of a different value than the
one about to be written would be worse than no preview — it would be
confidently wrong.

**A duplicate is reported, not refused.** Adding a rule the Campaign already
means 409s. Previewing one returns the preview with `duplicate: true`, since a
merchant who re-types their own campaign tag deserves an explanation rather than
an unexplained zero. It is the one place preview and save deliberately differ.

**Periods are now defined once.** `utils/attribution-period.util.ts` holds
`ATTRIBUTION_PERIODS` and `resolvePeriodRange`, previously private to
`AttributedRevenueService`. Two copies of "the last 30 days" disagreeing by an
hour would break the preview's promise silently, which is the worst way to break
it. The repository likewise shares one `attributableOrders` predicate between
the report's read and the preview's, so both resolve the same rows.

**Which Orders get named.** Up to ten of the claimed Orders, newest first, each
with its number, total, current Campaign and — the part that makes an
over-broad rule obvious — *the value the Order itself carries* in the field the
rule compares. `findPreviewableOrders` is its own read rather than two more
columns on the report's: the report has no use for an order number, and
`AttributableOrder` is deliberately reduced to what deciding a credit needs.

**API.** `GET /api/admin/campaigns/:id/rules/preview?field=&operator=&value=&period=&touch=`
under `campaigns.read` — a read is a read, even when it is a step in a write
flow. It takes the same three fields `CreateCampaignRuleDto` takes, so what is
previewed is what gets posted. Declared above any `:id/rules/:ruleId` route,
with a note saying why. Period defaults to `30d` and touch to `last`, matching
what the revenue report opens on, so the two answers line up by default.

**Admin UI.** A Preview button beside Add on the Matching Rules card, opening a
panel with three figures (what it would claim, how much of that is Unattributed
today, and the Campaign's before/after), an overlap row per other Campaign
carrying both directions on one line, and the named Orders. Deliberately not
automatic — a preview resolves every Order in the period against every rule in
the Store, which is not a thing to run per keystroke — and cleared the moment
any part of the rule is edited, for the same reason the endpoint echoes the
stored value. A rule reaching 80% of the period's Orders gets a warning saying
so in as many words. The panel exposes a period selector but not a touch
selector; it always resolves last touch and says so, which keeps the card
readable at the cost of a mismatch for a merchant reading a first-touch report.

**Tests.** `rule-preview.util.spec.ts` (21 tests, seam 2): what a rule claims,
both directions of overlap, all three disqualifications, the sample cap, and a
table-driven block that computes the preview and then the *actual*
`tallyAttributedRevenue` with the candidate in the rule set and requires them to
agree — the promise asserted directly rather than inferred.
`test/rule-preview.e2e-spec.ts` (17 tests, seam 1) drives the whole claim
against local Postgres: sales arrive through the storefront GraphQL API carrying
real UTM tags, are advanced to `paid` through the admin status endpoint, and the
preview is read through the admin REST API. It covers the claim figures, the
named Orders, the echoed host, the 400, the duplicate, an overlap that blocks
and one that takes, an over-broad rule, the Lookback Window, a crawler
classified through the real ingest API, the touch selector, a proof that
previewing twice leaves both the rule list and the revenue report untouched,
four shapes of rule previewed-then-saved-then-read-back through the real revenue
endpoint, and two Organizations whose identically named Campaigns cannot preview
against each other's traffic (404 on the other's campaign id).

Verified: `npm test` 199 passed (13 suites); `npm run test:e2e` 87 passed (6
suites); `nest build` and `tsc --noEmit` clean; eslint and `prettier --check`
clean on every file touched; frontend `npm run build` (which runs `tsc --noEmit`)
clean.

**No migration.** The preview reads the same columns ticket 02 landed and the
rules ticket 03 landed. Per ADR-0001 there is still no `campaign_id` on
`orders` — and the preview is the clearest argument for keeping it that way: a
cached resolution would have to be invalidated by a rule that has not been saved.

**Pre-existing lint failures are untouched.** `npm run lint` still fails on seven
`@typescript-eslint/unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`. `matching-rules-card.tsx` no longer fails
`prettier --check` — this ticket edits it, so it was formatted in passing.
