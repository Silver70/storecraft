# 04: Matching rules and normalized matching

**What to build:** A merchant can teach a Campaign to recognise the UTM variants their links actually went out with, so one marketing push tagged inconsistently is still reported as one Campaign.

A rule targets one attribution field — utm_campaign, utm_source, utm_medium, or referrer host — with an operator of `equals` or `starts_with` and a comparison value. Matching normalizes both sides: trimmed, lowercased, with hyphens, underscores and whitespace collapsed to one canonical separator. This is what makes `summer_sale`, `Summer-Sale` and `summer sale` a single Campaign without the merchant writing three rules, and it is the highest-value behaviour in this ticket.

When several rules could match one attribution tuple, resolution is deterministic: a rule on utm_campaign outranks one on utm_source or utm_medium, which outrank one on referrer host; `equals` outranks `starts_with`; remaining ties break by Campaign creation time, oldest first. A tuple matching no rule is Unattributed, which is always its own outcome and never redistributed.

This is the part of the feature that fails silently — a mis-match does not raise an error, it makes a Campaign look unprofitable forever — so the matching decision itself is exercised exhaustively as a pure unit, independent of the database.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] A merchant can add and remove matching rules on a Campaign
- [ ] Values differing only by hyphen, underscore, whitespace, case or surrounding padding resolve to the same Campaign
- [ ] When two rules could both match, the documented precedence decides, and the same tuple always resolves to the same Campaign
- [ ] A tuple matching no rule resolves to Unattributed
- [ ] An empty rule set resolves to Unattributed rather than erroring
- [ ] Matching is covered as a pure unit with no database or framework involved
- [ ] Rules are scoped to their Organization and Store and can never match another tenant's traffic
