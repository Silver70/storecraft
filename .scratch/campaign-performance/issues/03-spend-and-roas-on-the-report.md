# 03: Spend and ROAS on the performance report

**What to build:** The Campaign Revenue report becomes a performance report. Every
Campaign line carries the Spend recorded for the period beside the revenue it
earned, and the ROAS between them, so the merchant can rank Campaigns by what
they returned rather than by what they grossed.

Two behaviours matter more than the arithmetic:

**A Campaign that spent money and earned nothing must appear.** Today a Campaign
only makes the report if it is active or earned revenue, so an archived Campaign
quietly burning budget is simply absent — the most actionable row in an ad
account is the one the report cannot currently represent. Recording Spend in the
period becomes a third reason to appear.

**A Campaign with no Spend has no ROAS.** Not zero, not infinity — absent. Email,
organic, and affiliate Campaigns live in this table too, and either substitute
would sort them to an extreme of every ranking.

Revenue itself does not change. It stays the figure Stage 1 reports, so the two
stages reconcile and adding cost moves nobody's revenue numbers.

**Blocked by:** 01 (Record Spend against a Campaign).

**Status:** ready-for-agent

- [ ] The attributed-revenue read returns, per Campaign, the Spend recorded for the period and the resulting ROAS, and returns blended Spend, revenue, and ROAS across all Campaigns
- [ ] Existing fields of that read keep their current names and meanings; revenue for a period matches what the report returned before this ticket
- [ ] The period's `[start, end)` timestamp range is converted to start and end calendar dates in the Store's timezone, and Spend rows within those dates are what the period counts
- [ ] The shared period-range helper is reused rather than duplicated, so Spend and revenue never describe windows that disagree
- [ ] ROAS is a ratio rounded to two decimal places, not a money value, and the code says so plainly enough that nobody later converts it to cents
- [ ] ROAS is null when Spend is zero, and zero when there is Spend but no revenue
- [ ] A Campaign appears in the report if it is active, **or** earned revenue in the period, **or** recorded Spend in the period
- [ ] Unattributed keeps its own line, carries no Spend and no ROAS, and is still never redistributed across Campaigns
- [ ] The ROAS arithmetic lives in a pure utility covered by its own spec: zero Spend yielding null, zero revenue with Spend yielding zero, and integer revenue summed across many Orders producing no drift
- [ ] The report page shows Spend and ROAS columns, renders `—` for a null ROAS, and makes a Campaign with Spend and no revenue visually distinct rather than merely present
- [ ] The Lookback Window is still displayed next to the attributed figures
- [ ] The page states that Spend is recorded per day while revenue is recorded to the second, so a partial-day ROAS is not read as a collapse
- [ ] Switching between First Touch and Last Touch recomputes ROAS from the same rows
- [ ] End-to-end coverage: a Campaign with Spend and revenue reports the expected ROAS; a Campaign with Spend and no revenue appears in the report; a Campaign with revenue and no Spend reports no ROAS; and revenue for a period matches the Stage 1 figures for that period
