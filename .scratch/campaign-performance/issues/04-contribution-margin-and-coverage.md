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

**Status:** ready-for-agent

- [ ] The Orders read for a period carries, per Order, goods revenue, cost of goods summed only where a variant has a cost price, the revenue that had a known cost behind it, and the Order's discount amount
- [ ] Those figures accumulate into the same per-Campaign buckets the revenue tally already produces, through the same read-time matching — so a Campaign created after its ads ran gets its margin as well as its revenue, and a corrected matching rule repairs both
- [ ] Contribution Margin and cost coverage are returned per Campaign and on the blended totals
- [ ] Coverage follows the convention the analytics profit report already established rather than inventing a second one
- [ ] Contribution Margin is null when coverage is zero
- [ ] Negative Contribution Margins are returned as negative numbers and never clamped
- [ ] Every figure stays an integer in the smallest currency unit; coverage is a display-only percentage
- [ ] The margin arithmetic is covered as a pure unit: zero coverage yielding null, partial coverage reporting both the margin and the proportion it rests on, a discounted Order's discount subtracted exactly once, and no drift across many Orders
- [ ] The report page shows Contribution Margin with coverage beside it, and an explicit "no cost data" state rather than a number when coverage is zero
- [ ] The page names which revenue basis each of ROAS and Contribution Margin is built on
- [ ] End-to-end coverage: a period with cost prices set reports the expected margin and coverage; a period with none reports no margin but still reports coverage; and a discounted Order's discount is subtracted once
