# 04: Contribution Margin and cost coverage

**What to build:** Each Campaign line gains a Contribution Margin — the figure
that says whether to keep spending, where ROAS only says how much came back —
reported with the cost-price coverage that qualifies it.

Contribution Margin is goods revenue minus discounts minus cost of goods minus
Spend. It is built on the **goods basis**, not on the Order total, and that is
the decision this ticket turns on. Tax is collected and remitted and is never
profit. Discounts are already netted out of an Order's total at checkout, so
subtracting them from that figure would penalise a discounted Order twice; on
the goods basis they come off exactly once. Shipping is excluded from both sides
because shipping cost is not modelled anywhere, and counting the charge without
the cost inflates every margin.

The report therefore carries two revenue bases — the Order-total basis ROAS
divides, and the goods basis the margin is built on. Both are correct, they are
not the same number, and the page has to say which is which rather than leaving
the merchant to notice.

Cost price is nullable on variants and most merchants fill it in late, so
coverage is not a footnote. When no cost is known at all the margin is refused
rather than computed: a margin built on no cost data is not a conservative
estimate, it is fiction.

**Blocked by:** 03 (Spend and ROAS on the performance report).

**Status:** resolved

- [x] The Orders read for a period carries, per Order, goods revenue, cost of goods summed only where a variant has a cost price, the revenue that had a known cost behind it, and the Order's discount amount
- [x] Those figures accumulate into the same per-Campaign buckets the revenue tally already produces, through the same read-time matching — so a Campaign created after its ads ran gets its margin as well as its revenue, and a corrected matching rule repairs both
- [x] Contribution Margin and cost coverage are returned per Campaign and on the blended totals
- [x] Coverage follows the convention the analytics profit report already established rather than inventing a second one
- [x] Contribution Margin is null when coverage is zero
- [x] Negative Contribution Margins are returned as negative numbers and never clamped
- [x] Every figure stays an integer in the smallest currency unit; coverage is a display-only percentage
- [x] The margin arithmetic is covered as a pure unit: zero coverage yielding null, partial coverage reporting both the margin and the proportion it rests on, a discounted Order's discount subtracted exactly once, and no drift across many Orders
- [x] The report page shows Contribution Margin with coverage beside it, and an explicit "no cost data" state rather than a number when coverage is zero
- [x] The page names which revenue basis each of ROAS and Contribution Margin is built on
- [x] End-to-end coverage: a period with cost prices set reports the expected margin and coverage; a period with none reports no margin but still reports coverage; and a discounted Order's discount is subtracted once

## Comments

Implemented 2026-09-04.

**Refusing the margin is the ticket, and the refusal has a boundary.** The
checklist says the margin is null when coverage is zero. Coverage is zero in two
very different situations, and `margin.util.ts` treats them differently on
purpose: when goods were sold and *none* of them have a cost price the margin is
refused, because a margin built on no cost data is fiction; but when a Campaign
sold nothing at all, no cost prices are *missing* — there are no goods to have
priced — and its contribution is exactly `-spend`. That is the archived Campaign
quietly burning budget, the row ticket 03 exists to put on the page, and
blanking its margin would take back most of what ticket 03 bought. So the
condition is `goodsRevenue > 0 && revenueWithCost === 0`, not `coveragePct === 0`.
Keying it off the rounded display percentage would also have let a Campaign with
0.4% coverage lose its margin to a rounding rule. Both branches are pinned by
their own unit test and their own e2e test.

**Partial coverage reports the margin.** Refusing it would blank the report for
every merchant part-way through entering their cost prices, which is most of
them. The figure understates cost and so overstates itself, and the percentage
beside it is what says by how much — which is why coverage renders directly
under the margin in the same table cell rather than in a column of its own. A
merchant scanning a row does not look two columns away for the caveat on the
number they are reading.

**The goods basis is a second bucket, not a wider one.** `tallyAttributedRevenue`
now fills `goodsByCampaign` alongside `byCampaign`, in the same loop, from the
same `campaignCreditFor` verdict — so a Campaign created after its ads ran gets
its margin exactly when it gets its revenue, and a corrected rule repairs both or
neither. They are kept apart rather than merged because they are two different
revenue bases; one bucket offering two keys called revenue is an invitation to
subtract from the wrong one. Unattributed and the totals carry no goods basis at
all: nobody spent against them, so there is no margin to build there and a cost
figure would only invite one.

**Discounts come off once, and the e2e proves it rather than asserting it.** Two
otherwise identical orders, one with a $5 coupon, on two Campaigns with the same
cost price. Their margins differ by $5. Subtracting the discount from the
Order-total basis as well would make them differ by $10 — and nothing on screen
would reveal it, which is why the assertion is the difference and not the two
numbers.

**Coverage is the analytics profit report's, literally.** `pct` moved to
`src/shared/utils/percent.util.ts` and both callers import it; the analytics
service lost its private copy and changed in no other way. Two definitions is how
two screens come to disagree about what coverage means while both looking right.

**The read.** `findAttributableOrders` left-joins the line items and the catalog
and groups by `orders.id`, adding four columns: goods revenue, cost summed only
where `cost_price IS NOT NULL`, the revenue that had a cost behind it, and the
Order's own `discount_amount` (taken from the Order, not summed across the join,
which would multiply it by the basket size). The joins are left joins throughout,
so an Order with no line items or a deleted variant still reconciles. Cost price
is read live rather than snapshotted onto the line item, exactly as the analytics
profit report reads it — so entering cost prices this afternoon repairs last
month's margins, which the e2e asserts as its own case. `findPreviewableOrders`
deliberately did *not* gain these columns: a preview answers which Campaign wins
an Order, never what it cost.

**Frontend.** An eighth column, *Contribution margin*, carrying the money with
its coverage beneath it — `62% costed` in amber below 100%, `fully costed` at
100%, `spend only, no sales` where there were no goods, and an explicit
`No cost data` with `$X of goods, none costed` beneath it where the margin is
refused. Never a dash (which reads as "nothing here") and never a zero (which
reads as "broke even"). A sixth summary tile joins them, rendering a losing
account in the destructive colour rather than trusting a leading minus sign to
be noticed. Between the tiles and the table sits the two-bases note: ROAS divides
the order total, contribution margin is built on the goods basis, tax is never
profit and shipping is out of both sides because shipping cost is not tracked —
so the two differ and both are right. The tiles moved from five across to a
3×2 grid to fit six without shrinking them.

Verified: `npm test` 263 passed (17 suites, +20 — a new `margin.util.spec.ts`
plus goods-basis cases in `attributed-revenue.util.spec.ts`); `npm run test:e2e`
143 passed (7 suites, +6 in `campaign-revenue.e2e-spec.ts`, with the two
`blended` equality assertions widened to account for the new fields rather than
loosened to `toMatchObject`); `nest build` and backend `tsc --noEmit` clean;
frontend `npm run build` (which runs `tsc --noEmit`) clean; `npx eslint` clean on
every backend file touched; `prettier --check` clean on all of them. The page was
not exercised in a browser — there is none in this session — so its verification
is the type-check, the build, and the API underneath it.

**Out of scope, as specified.** No dashboard card and no Campaign detail panel —
tickets 05 and 06. The Campaign detail page still shows Spend without a margin of
its own.
