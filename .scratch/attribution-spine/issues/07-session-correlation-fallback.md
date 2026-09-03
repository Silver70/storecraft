# 07: Session-correlation fallback for undeclared attribution

**What to build:** An integrator who has not yet implemented attribution pass-through still gets partial campaign reporting, so adopting the platform is not all-or-nothing.

When a Cart reaches checkout carrying no declared attribution but carrying a session id, the system infers First Touch and Last Touch from the tracked event log for that session within the Lookback Window, and records that the attribution was `correlated` rather than `declared`. The merchant can tell the two apart and judge how much to trust each.

Declared attribution always wins. Correlation is a backstop, never the primary source: it depends on an event stream that can be blocked by the client and that the retention purge eventually deletes, which is precisely why ADR-0001 makes the declared snapshot authoritative.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] A Cart with a session id but no declared attribution produces an Order with attribution inferred from that session's events
- [ ] The resulting Order records its attribution source as `correlated`
- [ ] A Cart with declared attribution keeps it, and correlation does not override it
- [ ] Events outside the Lookback Window are not used for correlation
- [ ] Bot events are never used for correlation
- [ ] A Cart with neither declared attribution nor a session id checks out with attribution source `none`
- [ ] Correlation failing for any reason still yields a successful checkout
