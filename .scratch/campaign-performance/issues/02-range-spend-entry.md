# 02: Enter Spend across a date range

**What to build:** A merchant who knows a week's total but not each day's types
one figure with a start and end date, and gets one Spend row per day in that
range.

The daily rows must sum to **exactly** the total typed. Dividing integer minor
units across a range leaves a remainder, and it is added to the first day rather
than dropped or spread — money that does not add up is worse than money that is
unevenly distributed.

A range entry overwrites any existing rows for the days it covers, consistent
with the correction semantics ticket 01 established.

**Blocked by:** 01 (Record Spend against a Campaign).

**Status:** resolved

- [x] An admin endpoint records Spend across a date range for one Campaign, writing one row per day
- [x] The rows written sum to exactly the total submitted, with the remainder on the first day
- [x] The range overwrites existing rows for days it covers rather than adding to them
- [x] The same validation as single-day entry applies: no negative totals, no future dates, Store currency only
- [x] An inverted range (end before start) is rejected
- [x] The Campaign detail page offers range entry alongside single-day entry, and the rows it writes appear immediately in the list
- [x] The remainder split is covered as a pure unit alongside the existing marketing utility specs — a total that divides unevenly across its days still sums to the original
- [x] End-to-end coverage: a range entry writes the expected number of rows summing to the exact total, and re-running it over overlapping days corrects rather than doubles

## Comments

Implemented 2026-09-04.

**The sum is the ticket.** `splitAcrossDays` in the new
`spend-range.util.ts` derives the remainder as `total - base * days.length`
rather than as `total % days.length`, so the rows sum to the total by
construction instead of by two operators happening to agree, and puts that
remainder on the first day. The unit spec walks every remainder a seven-day
range can leave (0 through 6) rather than picking one, because the failure is
silent: nothing throws when cents go missing, the report is just quietly wrong
against the invoice it was reconciled from. `$100.00 / 7 days` is `1432` on day
one and `1428` on the other six.

**The range is one statement, not a loop.** `CampaignSpendRepository.recordMany`
is a single multi-row `INSERT ... ON CONFLICT DO UPDATE`, which makes the whole
range atomic without an explicit transaction — a failure partway cannot leave a
merchant with three days of a seven-day total recorded and nothing saying which
four are missing. Its `set` clause reads `excluded.amount` rather than a
captured value, because each row of the statement conflicts with a *different*
existing row and must take its own new figure; a literal would write the last
day's amount onto every conflicting day. The e2e suite asserts the refusal cases
write nothing at all, which is what covers that.

**Overwrite, not add, is inherited rather than reimplemented.** The range upsert
targets the same `campaign_spend_campaign_day_unique` constraint ticket 01
added, so a re-run over overlapping days corrects them for the same reason a
double-submitted single day does. The overlap test is the one that matters: a
seven-day $700 entry followed by a three-day $60 entry over its last three days
leaves seven rows totalling $460, not ten rows or $760.

**Day arithmetic is done in UTC.** `enumerateDays` walks `Date.UTC` millis
because a calendar date carries no offset and UTC has no DST — a local-midnight
walk across a spring-forward would repeat or skip a date, and the rows would
stop lining up with the days the merchant picked. There is a spec for exactly
that transition.

**One refusal beyond what the ticket asked for.** Nothing bounds how far *back*
a start date may go — the future check only guards the other end — so
`1900-01-01` to today would have asked for roughly 46,000 rows in one request.
`MAX_SPEND_RANGE_DAYS` is 366, sized so a full leap year still fits (asserted,
so nobody trims it to 365 later), and a longer range is refused with the day
count in the message. Raising it rather than doing it silently: it is a
constraint the ticket did not name, and a merchant with a genuine multi-year
closeout would hit it.

**`total`, not `amount`.** The DTO, the service input, and the form label all
say *total* for the range figure. A field named `amount` sitting beside the
single-day call that also takes `amount` would make "700 per day" the easy
misreading of "700 for the week", and it is a seven-fold error that nothing
downstream would flag.

**Frontend.** The Spend card's entry area now has a two-tab switch — *One day* /
*Date range* — and the old inline form moved into a `SingleDayEntry` component
beside the new `RangeEntry` rather than growing more state on the card. The
range defaults to the last seven days ending on the Store's today (still read
from the API, never the browser's clock), and shows the row count before
submitting: "Writes 7 rows, one per day, adding up to exactly the total you
enter." The **split itself is deliberately not reimplemented in the browser** —
only the row count is computed there. A second implementation of the remainder
rule would be free to drift from the one that writes the rows, and would show
the merchant a per-day figure that is not what was saved. Both forms invalidate
the same query prefix, so written rows appear in the list immediately. An
inverted range is caught inline before submitting as well as by the backend.

Verified: `npm test` 231 passed (15 suites, +20 in `spend-range.util.spec.ts`);
`npm run test:e2e` 131 passed (7 suites, +18 in `campaign-spend.e2e-spec.ts`);
`nest build` and backend `tsc --noEmit` clean; frontend `npm run build`
(which runs `tsc --noEmit`) clean; `prettier --check` clean on every backend
file touched and on `features/campaigns/server.ts`; `npx eslint
src/modules/marketing test/campaign-spend.e2e-spec.ts` clean. The range form was
not exercised in a browser — there is no browser in this session — so its
verification is the type-check, the build, and the API underneath it.

`campaign-spend-card.tsx` is left in its own 4-space/120-column style rather
than reformatted: it was already not Prettier-clean under the root config before
this ticket, and the frontend has no ESLint or Prettier config of its own.

**Out of scope, as specified.** Nothing reads Spend into a report yet — no
ROAS, no Contribution Margin, no report column. That is tickets 03 and 04.
