# Campaign Performance

Status: ready-for-agent

Stage 2 of the product roadmap — "make spend legible". Builds directly on the
Attribution Spine (`.scratch/attribution-spine/`) and respects ADR-0001
(attribution snapshot on Order) and ADR-0002 (Campaign as a first-class entity).

## Problem Statement

The merchant can now see how much revenue each Campaign produced. They still
cannot see whether any of it was worth having.

Stage 1 answered "which push drove sales". A Campaign that returned $4,000 sits
at the top of the report and looks like the best thing in the account — and it
may have cost $6,000 to run, or it may have sold goods that cost $3,800 to buy.
Nothing in the system knows what was spent, so nothing in the system can say
which Campaign to feed and which to kill. The merchant is reading a leaderboard
of gross revenue and making budget decisions from it, which is the specific way
ad accounts lose money quietly: the biggest revenue line is very often the
worst-performing one, and the report as it stands cannot distinguish them.

Worse, the report currently hides the most important row entirely. A Campaign
that spent real money and produced no Orders shows as a zero-revenue line
indistinguishable from a Campaign that was never funded. The single most
actionable fact in an ad account — "this one is burning money" — is exactly the
fact the current report cannot represent.

Cost of goods makes the same point again a level down. A high-ticket air
conditioner and a paperback both count as revenue, and revenue that is 12%
margin is not the same money as revenue that is 60% margin. A Campaign can beat
every other Campaign on ROAS and still lose money on every sale.

## Solution

The merchant records Spend against a Campaign — one row per Campaign per day,
in the Store's currency, entered by hand.

The existing Campaign Revenue report grows into a performance report. Beside
revenue and Order count, each Campaign line carries the Spend for the period,
its ROAS, and its Contribution Margin reported with the cost-price coverage that
qualifies it. Campaigns with Spend appear whether or not they earned anything,
so a Campaign that burned money is the loudest row on the page rather than an
absent one. Unattributed keeps its own line and still receives no Spend.

The admin dashboard gains one summary card: what was spent this period, what
came back, and the blended ROAS across the whole account, with the Unattributed
share shown next to it so the ratio is read with the right caveat.

Nothing about how revenue is attributed changes. Spend is a new fact recorded
alongside Campaigns; ROAS and Contribution Margin are arithmetic performed at
read time on figures Stage 1 already produces.

## User Stories

### Recording Spend

1. As a merchant, I want to record what I spent on a Campaign on a given day, so that the revenue it produced can be judged against its cost.
2. As a merchant, I want to record Spend for a day that has already passed, so that setting this up after a Campaign has been running does not lose its cost history.
3. As a merchant, I want re-entering Spend for a day I have already entered to correct that day rather than add to it, so that a double-submit or a corrected figure cannot silently inflate my costs.
4. As a merchant, I want to edit a Spend row after saving it, so that a typo does not permanently distort a Campaign's ROAS.
5. As a merchant, I want to delete a Spend row, so that a figure entered against the wrong Campaign can be removed rather than zeroed.
6. As a merchant, I want to enter one figure across a date range and have it recorded as daily rows, so that entering a week of spend does not mean seven forms.
7. As a merchant, I want a range entry to add up to exactly the total I typed, so that rounding across days does not quietly lose or invent cents.
8. As a merchant, I want to see every Spend row I have recorded for a Campaign, so that I can check what I entered against what the ad platform charged me.
9. As a merchant, I want Spend entered in the Store's currency and stored in minor units, so that it is the same kind of money as every other figure in the system.
10. As a merchant, I want Spend recorded against a Campaign that is already archived, so that closing out a finished Campaign's real cost is still possible.
11. As a merchant, I want to be stopped from entering a negative Spend, so that a mistyped minus sign cannot make a losing Campaign look profitable.
12. As a merchant, I want to be stopped from entering Spend dated in the future, so that a mistyped year does not sit in my account distorting nothing visible.
13. As a merchant, I want a Spend day interpreted in my Store's timezone, so that the day I enter is the day my ad platform reports.
14. As a merchant, I want Spend rows to belong to my Organization alone, so that no other tenant's costs can ever appear against my Campaigns.

### Reading performance

15. As a merchant, I want each Campaign's Spend for the period shown beside its revenue, so that both halves of the decision are on one line.
16. As a merchant, I want a ROAS for each Campaign, so that I can rank Campaigns by what they returned rather than by what they grossed.
17. As a merchant, I want a Campaign with no Spend to show no ROAS rather than a zero or an infinity, so that organic and email Campaigns are not ranked as catastrophic or miraculous.
18. As a merchant, I want a Campaign that spent money and produced no revenue to appear in the report, so that the money I am losing is visible rather than absent.
19. As a merchant, I want a Contribution Margin for each Campaign, so that I can tell a Campaign that returned money from one that returned profit.
20. As a merchant, I want the cost-price coverage shown next to every Contribution Margin, so that I know what proportion of the revenue actually had a known cost behind it.
21. As a merchant, I want a Contribution Margin refused rather than guessed when no cost prices are known, so that a margin figure is never fabricated from missing data.
22. As a merchant, I want a negative Contribution Margin displayed as a loss rather than clamped at zero, so that the Campaigns to kill are unmistakable.
23. As a merchant, I want to sort or scan the report by ROAS as well as by revenue, so that the best-returning Campaign is findable and not buried under the biggest-grossing one.
24. As a merchant, I want the Lookback Window still shown next to every attributed figure, so that I keep understanding why my ROAS disagrees with the ad platform's.
25. As a merchant, I want blended totals across all Campaigns — total Spend, total attributed revenue, blended ROAS, total Contribution Margin — so that I can see the account as a whole and not only line by line.
26. As a merchant, I want the Unattributed share shown beside the blended figures, so that I know how much of my revenue those totals are ignoring.
27. As a merchant, I want Unattributed to carry no ROAS, so that a bucket nobody spent against is never presented as performance.
28. As a merchant, I want to switch the report between First Touch and Last Touch and have ROAS and Contribution Margin follow, so that both readings are cost-aware.
29. As a merchant, I want the same period selector the revenue report already had, so that nothing about how I read the report changes.
30. As a merchant, I want to be told that Spend is recorded per day while revenue is recorded to the second, so that a ROAS read at 9am on a partial day does not look like a collapse.
31. As a merchant, I want revenue in this report to remain exactly the figure Stage 1 reported, so that adding cost does not silently move my revenue numbers.

### Seeing it on the dashboard

32. As a merchant, I want a summary card on the dashboard showing what I spent and what came back this period, so that I notice a problem without navigating to the Marketing section.
33. As a merchant, I want a blended ROAS on that card, so that the health of all ad spend is one number on the page I open first.
34. As a merchant, I want the card to link through to the full report, so that a bad number is one click from its explanation.
35. As a merchant, I want the card to be honest when I have recorded no Spend at all, so that an empty account shows an invitation rather than a broken-looking zero.
36. As a merchant, I want the card to show the Unattributed share, so that the blended ratio on my dashboard is not read as more complete than it is.
37. As a merchant, I want the dashboard to keep working if the marketing read fails, so that one report cannot take down the page I open first.

### Working with Campaigns

38. As a merchant, I want to enter Spend from the Campaign's own page, so that recording a cost happens where I am already looking at the Campaign.
39. As a merchant, I want to see that Campaign's own ROAS and Contribution Margin on its page, so that I can judge one Campaign without reading the whole table.
40. As a merchant, I want the Spend I enter to be reflected in the report immediately, so that I can trust that what I typed is what is being divided.
41. As a support agent, I want to be unable to record Spend, so that cost data cannot be altered by a role that has no business setting budgets.

### Safety and correctness

42. As a merchant, I want all money in this feature kept as integers in minor units, so that repeated arithmetic never drifts by a cent.
43. As a merchant, I want ROAS to be a ratio rather than a money value, so that nobody later "corrects" it into cents.
44. As a merchant, I want Contribution Margin to subtract discounts exactly once, so that a discounted Order is not penalised twice.
45. As a merchant, I want tax excluded from Contribution Margin, so that money I collect and remit to a government is never reported as profit.
46. As a merchant, I want deleting a Campaign to be impossible while it explains Orders, so that removing a Campaign cannot orphan its Spend or rewrite revenue history.

## Implementation Decisions

### Scope boundary

This stage adds cost to a report that already exists. It does not change how
attribution is captured, resolved, or frozen. Any change to Stage 1 behavior in
service of this work is out of scope and should be raised rather than made.

### Modules

- The **marketing** module owns everything here: a Spend repository and service,
  Spend CRUD endpoints, the cost-aware read, and the summary read. No new
  backend module.
- The **dashboard** module is deliberately **not** modified. The existing rule
  in this codebase is that a report module never depends on another report
  module — analytics owns its own period helper rather than importing the
  dashboard's, and marketing owns its own rather than importing analytics'.
  Making the dashboard service read Campaigns and Spend would break that rule.
  Instead marketing exposes a summary endpoint and the **dashboard page**
  composes the card from a second request. The coupling lives in the frontend,
  where it is cheap.
- The **admin frontend** grows the existing Campaigns feature area. The Marketing
  sidebar section already exists from Stage 1 and gains no new entry.
- The **product**, **order**, **cart**, and **analytics** modules are read from
  but not modified.

### Schema

One new table, `campaign_spend`, tenant-scoped with `organization_id` as its
second column per the project-wide rule and also scoped by `store_id`. Columns:
a reference to the Campaign, `day` as a calendar `date`, `amount` as an integer
in the smallest currency unit, the three-letter `currency`, an optional short
note, and timestamps.

A unique constraint on `(campaign_id, day)`. Recording Spend is an **upsert**
against that constraint, not an insert: re-entering a day corrects it. This is
the single most important decision in the table, because the failure it prevents
— a double-submit doubling a day's cost and halving a Campaign's ROAS — is
silent, and would make a good Campaign look bad forever.

`currency` is denormalized onto the row rather than read from the Store at
report time, so that changing a Store's currency later cannot silently
reinterpret historical Spend as a different unit of money. There is no currency
conversion anywhere in this feature; Spend in a currency other than the Store's
is rejected at the API boundary.

Spend rows are editable and deletable, unlike Campaigns, which archive rather
than delete. A Campaign is history that explains Orders; a Spend row is a
data-entry record of what a merchant typed, and a wrong one should be removable
rather than preserved.

The `day` is a calendar date, interpreted in the Store's timezone (`stores.timezone`).
It is stored as a date and never as a timestamp, because ad platforms report
daily totals and pretending to more precision than that would be a lie.

### Spend entry semantics

Single-day entry takes a Campaign, a date, and an amount. Range entry takes a
Campaign, a start and end date, and a total, and writes one row per day in the
range. The total is divided in integer minor units and **the remainder is added
to the first day**, so the rows sum to exactly the amount typed. A range entry
overwrites any existing rows for the days it covers, consistent with the upsert
rule.

Amounts must be zero or positive. Dates in the future are rejected. Spend may be
recorded against an archived Campaign — closing out a finished Campaign's real
cost is a normal thing to want.

### Cost-aware read

The existing attributed-revenue read is extended rather than duplicated. There
is one report, computed one way, so a cost-aware figure and a revenue-only
figure can never disagree.

The Orders read for a period gain four more per-Order figures, joined from their
line items: goods revenue (the sum of line totals), cost of goods (summed only
where a variant has a cost price), the revenue that had a known cost behind it,
and the Order's discount amount. These accumulate into the same per-Campaign
buckets the revenue tally already produces, through the same read-time matching
— so a Campaign created after its ads ran gets its margin as well as its
revenue, and a corrected matching rule repairs both.

Spend for the period is read separately and summed per Campaign. The period's
`[start, end)` timestamp range is converted to a start and end calendar date in
the Store's timezone, and Spend rows within those dates are counted.

**Spend is day-grained while revenue is timestamp-grained.** For `today`, and
for the current day of any longer period, a full day's Spend is compared against
a partial day's revenue, which reads as a ROAS collapse in the morning. This is
inherent to daily cost data and is not worked around; the UI states it.

### Performance arithmetic

A new pure utility computes, from a bucket and its Spend:

- **ROAS** = attributed revenue ÷ Spend. Returned as a **ratio**, rounded to two
  decimal places — not a money value, so the integer-cents rule does not apply
  to it, and this is stated in the code so nobody later "fixes" it. When Spend
  is zero, ROAS is `null`, never zero and never infinity: a Campaign nobody
  funded has no return-on-spend, and rendering one would sort organic Campaigns
  to the top or bottom of every ranking.
- **Contribution Margin** = goods revenue − discount amount − cost of goods −
  Spend. Computed on the goods basis, not on the Order total, for two reasons.
  Tax is collected and remitted and is never profit. Discounts are already
  netted out of an Order's `total` at checkout, so subtracting them from that
  figure would penalise a discounted Order twice; on the goods basis they are
  subtracted exactly once, which is what the glossary definition means. Shipping
  is excluded from both sides because shipping cost is not modelled anywhere,
  and counting the charge without the cost would inflate every margin.
- **Cost coverage** = the proportion of goods revenue that had a known cost
  price behind it, matching the `coveragePct` the analytics profit report
  already computes. When coverage is zero the Contribution Margin is `null`
  rather than a number: per the glossary this figure is never reported bare, and
  a margin computed from no cost data at all is not a conservative estimate, it
  is fiction.
- Negative Contribution Margins are returned as negative numbers and never
  clamped.

**Attributed revenue itself does not change.** It stays the Order total figure
Stage 1 reports, so the two stages reconcile and adding cost does not move
anyone's revenue numbers. The report therefore carries two revenue bases — the
Order-total basis that ROAS divides, and the goods basis that Contribution
Margin is built on — and says so on screen.

### Report composition

The per-Campaign lines the report returns change in one further way: a Campaign
now appears if it is active, **or** it earned revenue in the period, **or** it
recorded Spend in the period. The third condition is new and is the point of the
stage — an archived Campaign that quietly spent money must not vanish from the
report.

Blended totals accompany the lines: total Spend, total attributed revenue,
blended ROAS across the account, total Contribution Margin with its own coverage
figure, and the Unattributed bucket unchanged. Unattributed carries revenue and
Order count as before and carries no Spend and no ROAS.

### API contracts

New admin REST endpoints under the marketing controller surface, guarded by the
same role-based permissions as the rest of the module — `campaigns.read` for
reads and `campaigns.write` for writes, which keeps Spend out of the support
agent's hands:

- List a Campaign's Spend rows for a period.
- Record Spend for a single day (upsert).
- Record Spend across a date range (upsert per day).
- Update a Spend row.
- Delete a Spend row.
- The existing attributed-revenue read gains Spend, ROAS, Contribution Margin,
  and coverage on every line and on the totals. Its existing fields keep their
  current names and meanings.
- A summary read for the dashboard card: period Spend, period attributed
  revenue, blended ROAS, Unattributed share, and the active Lookback Window.

The period and touch parameters, and the shared period-range helper, are reused
exactly as they are. Two definitions of "the last 30 days" that disagree by an
hour would make Spend and revenue describe different windows.

### Frontend

The existing Campaign Revenue page becomes the performance report: same route,
same period and touch controls, new columns. A Campaign with Spend and no
revenue is visually distinct rather than merely present. ROAS renders as `—`
when there is no Spend, and Contribution Margin renders as an explicit "no cost
data" state rather than a number when coverage is zero, with coverage shown
beside it otherwise.

The Campaign detail page gains a Spend section: the rows recorded for the
selected period, inline entry for a single day, a range-entry control, and that
Campaign's own ROAS and Contribution Margin.

The dashboard page gains one card composed from the marketing summary endpoint,
fetched independently so a failure in it degrades to a hidden or errored card
rather than taking down the dashboard. With no Spend recorded anywhere the card
shows an empty state that invites recording some, not a zero.

Money is formatted only at the edge, through the existing frontend money
helper. ROAS and percentages are display-only derivations.

### Multi-tenancy

Spend rows go through the existing tenant-scoped repository base with
row-level security as the second line of defence, exactly like Campaigns and
matching rules. Every Spend read is scoped by Organization and Store before any
Campaign filter is applied.

## Testing Decisions

A good test here asserts what a merchant would see: money in, money out, and the
ratio between them. It does not assert that a service method was called, what a
repository received, or how a query was composed. The risk in this feature is
arithmetic that is wrong in a way nobody notices — a doubled Spend row, a
discount subtracted twice, a margin computed from cost data that was not there —
and a mock cannot see any of those.

Two seams, both already in the codebase. No new seams, confirmed with the
developer.

**Seam 1 — the admin REST API end to end, real services against local Postgres.**
The existing e2e harness and its admin and storefront fixtures. The flow: seed
Orders through the storefront GraphQL API carrying UTM tags, record Spend
through the admin API, read the performance report back, and assert the figures.
Cases to cover: a Campaign with Spend and revenue reporting the expected ROAS
and Contribution Margin; re-entering a day's Spend correcting rather than
doubling it; a range entry writing daily rows that sum to exactly the total
typed; a Campaign with Spend and zero revenue appearing in the report; a
Campaign with revenue and no Spend reporting no ROAS; a period with no cost
prices reporting no Contribution Margin but still reporting coverage; a
discounted Order's discount subtracted exactly once; Spend recorded against an
archived Campaign still counting; a negative amount and a future date both
rejected; the revenue figures matching what the Stage 1 report returns for the
same period; and Spend never crossing an Organization boundary.

**Seam 2 — the performance arithmetic as a pure unit.** Inputs are a revenue
bucket, its cost figures, and a Spend total; outputs are ROAS, Contribution
Margin, and coverage. No database, no framework. Cases: zero Spend yielding a
null ROAS rather than zero or infinity; zero revenue with Spend yielding a ROAS
of zero and a negative margin; zero coverage yielding a null margin; partial
coverage reporting both the margin and the proportion it rests on; integer
arithmetic across many Orders producing no drift; and the range-split remainder
landing so the daily rows sum to the exact total.

Deliberately not used: repository-level tests, which exercise the ORM rather
than behavior; mocked-repository service specs, for the false-confidence reason
above; and frontend or component tests, per the standing position that the
testing floor rises only where blast radius is money or tenancy.

Prior art: `test/campaign-revenue.e2e-spec.ts` and `test/admin-campaigns.e2e-spec.ts`
establish Seam 1's shape, including the seeded Organization that every
tenant-scoped table cascades from. `src/modules/marketing/utils/attributed-revenue.util.spec.ts`
and `campaign-matching.util.spec.ts` establish Seam 2's. Tests run against local
Postgres via `.env.test` and clean up the rows they create.

## Out of Scope

- **Ad-platform integrations.** No Meta, Google, or TikTok API. Spend is typed
  in by hand. Both platforms require an application and review process and
  become a permanent maintenance surface; this waits until a paying user asks.
- **Currency conversion.** Spend is recorded in the Store's currency only. A
  multi-currency account is a larger problem than this stage.
- **CSV import of Spend.** Manual entry and range entry cover a solo merchant
  running a handful of Campaigns. Import becomes worth building when someone is
  running enough Campaigns to need it.
- **Budgets, pacing, and alerts.** No target ROAS, no overspend warning, no
  notification. Reporting what happened comes before reacting to it.
- **Shipping cost in Contribution Margin.** Shipping cost is not modelled
  anywhere in the system, so it cannot be subtracted. Both the shipping charge
  and its cost are excluded from the margin.
- **Audit logging of Spend edits.** Audit logging is currently reserved for
  stock and money movement. A Spend row carries its own `updated_at` and this is
  a single-operator account today; revisit when more than one person can edit
  costs.
- **Attribution changes of any kind.** Capture, matching, normalization,
  lookback, correlation fallback, and the frozen snapshot all stay exactly as
  Stage 1 left them.
- **Per-Order profitability.** Contribution Margin is reported per Campaign for
  a period, not per Order.
- **Multi-touch or fractional credit.** Still First Touch or Last Touch only,
  chosen at read time.
- **The Starter Storefront and the CMS.** Stages 3 and 4.

## Further Notes

**A zero-Spend ROAS is the decision most likely to be reversed by someone who
does not read this.** Returning `null` rather than `0` or `Infinity` is what
keeps email, organic, and affiliate Campaigns from sorting to an extreme of
every ranking. It costs a nullable field in the contract, and it is worth it.

**The two revenue bases will confuse someone eventually.** ROAS divides the
Order total, because that is the revenue Stage 1 reports and the figure that
reconciles with the sales reports. Contribution Margin builds on goods revenue,
because tax is not profit and discounts are already netted out of the Order
total. Both are correct, they are not the same number, and the report has to say
which is which on screen rather than leaving the merchant to notice.

**Cost coverage is what makes Contribution Margin honest.** Cost price is
nullable on variants and most merchants fill it in late, so a margin figure
computed early in a Store's life rests on a fraction of its revenue. The
analytics profit report already made this decision and reports `coveragePct`
beside the margin; this feature follows it exactly rather than inventing a
second convention.

**Daily Spend against timestamped revenue is a real, permanent mismatch.** Ad
platforms report daily. Nothing here can make Spend more precise than that, so
partial-day ROAS is structurally misleading and the honest fix is to say so
rather than to interpolate a fraction of a day's Spend, which would invent
precision that does not exist.

**The upsert on `(campaign_id, day)` is load-bearing.** Insert semantics would
make a double-submit halve a Campaign's ROAS silently and permanently, which is
the same category of failure as a missing `utm_campaign` — wrong forever, and
never throwing.

**This stage completes the moat.** Stage 1 made revenue traceable; this makes it
judgeable. After this, the merchant can answer "should I keep spending on this"
from the admin, which was the reason the whole attribution sequence was
prioritised ahead of the storefront and the CMS.
