---
status: accepted
---

# Campaign is a first-class entity, not a UTM string

A Campaign is the thing money is spent on; a UTM tuple is evidence that a visit
came from one. We model Campaign as its own table (name, platform, external
ad-platform id, status) with matching rules that map incoming UTM tuples onto
it, rather than grouping orders by the literal `utm_campaign` string.

## Considered options

String-grouping needs no new table and no matching logic. We rejected it because
UTM strings are typed by hand into ad platforms: the same boosted post tagged
`summer_sale` once and `summer-sale` once becomes two campaigns forever, Spend
gets entered against one, and ROAS is silently wrong by half with nothing in the
UI indicating a problem. String-grouping also has nowhere to store an
`external_campaign_id`, so adding the Meta Marketing API later would force the
migration anyway.

## Consequences

Spend attaches to a Campaign, so entering it is unambiguous. The admin generates
canonical tagged URLs from the Campaign id, making matching exact by
construction; matching rules remain the safety net for links tagged by hand
before the Campaign existed. Campaigns are managed objects with CRUD, so they
live in a Marketing section of the admin alongside Discounts — not as a tab on
the read-only Analytics page.
