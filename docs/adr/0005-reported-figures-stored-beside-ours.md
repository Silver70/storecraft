---
status: accepted
---

# Ad-platform figures are stored beside ours, never merged into them

An ad platform reports its own spend, conversions and ROAS, on its own
attribution window and in its ad account's currency. We keep those Reported
Figures in their own daily records, labelled with their source, and show them
next to ours. They never overwrite a merchant's own Spend, and they are never an
input to Contribution Margin.

## Considered options

Trusting the platform's numbers where present and ours as a fallback was
rejected because it makes a revenue total incomparable with itself: the same
period reports differently depending on which ads happened to be synced that
day. Recording only our own throws away the cheapest reconciliation a merchant
has, and the disagreement is itself the useful signal.

Converting a foreign-currency ad account into the Store's currency at ingest was
rejected because `campaign_spend` deliberately has no conversion anywhere in it,
and an FX rate inside a margin calculation corrupts it silently — the failure
class this whole feature exists to avoid. A figure in another currency is stored
as what it is, and no cross-currency ROAS or margin is computed from it.

## Consequences

Contribution Margin stays honest: computed only from Orders whose goods have
cost prices, never from a platform's conversion value, which has no cost basis
behind it. Our figures and theirs will disagree — the Lookback Window is already
displayed for exactly that reason, and the source label extends it.

A merchant's hand-entered Spend and a synced figure can both describe one day.
The row records which it is; a sync wins by default, and a day corrected by hand
can be pinned, so reconciling against an invoice is not silently reverted an
hour later.

The ad platform can be lost without losing the feature. Reported Figures are an
ingest, and the manual Spend path they arrive beside stays first-class rather
than becoming a migration artifact.
