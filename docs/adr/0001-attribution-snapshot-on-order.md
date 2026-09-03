---
status: accepted
---

# Attribution is a snapshot stamped on the Order, not a query against events

Revenue-by-Campaign requires a join between the analytics event log (which knows
UTM and referrer) and orders (which know money). We stamp Attribution — First
Touch and Last Touch UTM tuples, referrer, landing path, and `visitor_id` — onto
the Cart when it is created and copy it onto the Order at checkout, as immutable
columns. We do not derive Attribution at read time by querying
`analytics_events`.

## Considered options

Deriving Attribution at read time by correlating `session_id` against
`analytics_events` needs no storefront change and no new columns, which is why
it is tempting. We rejected it because it makes revenue truth depend on an
ad-blockable client event stream, and because our own retention cron
(`ANALYTICS_RETENTION_DAYS`, default 90d) deletes the rows the join depends on —
so historical ROAS would silently degrade as events aged out.

## Consequences

Attribution becomes part of the **public API contract**: the storefront passes
an attribution object on cart creation, so changing its shape is a breaking
change for integrators. Session-based correlation is kept as a *fallback* for
callers that omit it, never as the primary source. Attribution follows the same
rule as order line items — it is a snapshot of conditions at purchase time and
never changes afterward, including when the same Visitor later arrives from a
different Campaign.
