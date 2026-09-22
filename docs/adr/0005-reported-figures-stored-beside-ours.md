---
status: superseded by ADR-0006
---

# Ad-platform figures are stored beside ours, never merged into them

An ad platform reports its own spend, conversions and ROAS, on its own
attribution window and in its ad account's currency. We keep those Reported
Figures in their own daily records, labelled with their source, and show them
next to ours. They are never an input to Contribution Margin.

The boundary runs between the cost side and the revenue side, and it is worth
stating precisely. **Spend crosses it**: what an ad account was charged is the
same fact a merchant would otherwise read off the platform's dashboard and type
in by hand, so a sync records it in `campaign_spend` against the Ad that claims
the platform's ad, in the Store's own currency, with `source = 'synced'` on the
row. **Reported revenue, conversions and ROAS do not cross it**, ever: those are
claims made on an attribution window that is not ours, and a revenue total that
changed depending on what happened to sync that day would be incomparable with
itself.

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
hour later. A sync refused by a pinned day records that it declined rather than
failing — a pin is a decision, and a connection reporting it as an error would
show the merchant a problem where there is none.

A pin binds the sync and never the merchant. Any Spend row stays editable,
pinnable and deletable whatever wrote it, and a hand write always lands.

The ad platform can be lost without losing the feature. Reported Figures are an
ingest, and the manual Spend path they arrive beside stays first-class rather
than becoming a migration artifact.
