# 07: Session-correlation fallback for undeclared attribution

**What to build:** An integrator who has not yet implemented attribution pass-through still gets partial campaign reporting, so adopting the platform is not all-or-nothing.

When a Cart reaches checkout carrying no declared attribution but carrying a session id, the system infers First Touch and Last Touch from the tracked event log for that session within the Lookback Window, and records that the attribution was `correlated` rather than `declared`. The merchant can tell the two apart and judge how much to trust each.

Declared attribution always wins. Correlation is a backstop, never the primary source: it depends on an event stream that can be blocked by the client and that the retention purge eventually deletes, which is precisely why ADR-0001 makes the declared snapshot authoritative.

**Blocked by:** 02

**Status:** resolved

- [x] A Cart with a session id but no declared attribution produces an Order with attribution inferred from that session's events
- [x] The resulting Order records its attribution source as `correlated`
- [x] A Cart with declared attribution keeps it, and correlation does not override it
- [x] Events outside the Lookback Window are not used for correlation
- [x] Bot events are never used for correlation
- [x] A Cart with neither declared attribution nor a session id checks out with attribution source `none`
- [x] Correlation failing for any reason still yields a successful checkout

## Comments

Implemented 2026-09-04.

**Correlation happens once, at checkout, and never on the Cart.** A Cart keeps
recording only what it was told; `CartAttributionService.resolveForOrder` is
where the fallback runs, so the inference lands on the Order — the row that has
to outlive the event log — and an open Cart is never rewritten by a background
read. Declared attribution short-circuits it before any query is made, which is
what makes "declared always wins" a property of the code path rather than a
precedence rule applied afterwards.

**The event-log read lives in analytics; the decision to use it lives in cart.**
`SessionTouchService.findTouches` is the only read of `analytics_events` from
outside that module, exported for this one purpose. It returns just the two ends
of a session's attributed arrivals — two one-row reads rather than a scan, since
a chatty session holds hundreds of events and only its ends can ever become a
Touch, with ties on `occurred_at` broken by id so the same session always yields
the same pair.

**Bot exclusion and the Lookback Window are applied by the read itself.** The
query carries the same `device_type <> 'bot'` clause every other event query
uses (a NULL classification is a Phase 2 event and still counts as human) and is
bounded by `[now - ATTRIBUTION_LOOKBACK_DAYS, now]`, so a stale or crawler touch
is never a candidate rather than being filtered out afterwards. An event
carrying neither a UTM value nor a referrer is a direct arrival and is excluded
too — the same rule `isAttributedTouch` applies to a declared touch.

**One fold, two markers.** `applyDeclaredAttribution` and the new
`applyCorrelatedAttribution` both delegate to a private `applyTouches`, so where
a touch came from changes only the marker written beside it and never which
touch wins. A session that yields nothing leaves the snapshot untouched: "we
looked and found nothing" records as `none`, not as a correlation of nothing.

**The correlated Order adopts the session's `visitor_id`.** Precisely the Orders
that need correlating are the ones whose Cart was never told a visitor id, and
the attributed-revenue report's bot check joins on session *or* visitor id — so
taking the id the event log already knows for that session is what lets that
check, and any later cross-session read, find the Order at all.

**Failure is contained inside the service, not only at the checkout boundary.**
`resolveForOrder` catches its own correlation failure, logs a warning and
returns the Cart's own snapshot. Checkout's existing try/catch stays as the last
resort, but it degrades to `emptyAttribution()`, which would discard a *declared*
snapshot as well; catching here means a broken event log costs only the
inference it was going to add.

**Tests.** Seven new cases in `test/storefront-attribution.e2e-spec.ts`, driven
through the public APIs the way an integrator meets them — events posted to
`POST /api/events` (bot traffic produced by sending a crawler User-Agent, since
the classification is server-derived), the cart and checkout through the
storefront GraphQL API, and assertions read off the persisted `orders` row:
correlation from a session's events; a declared touch surviving contradicting
events; a touch older than the window not qualifying; bot events never used; a
Cart with no session id staying `none` while events for another session exist; a
session id colliding across two Organizations never leaking a Campaign; and a
sale completing with `none` when the event log is unreachable. Two unit cases
cover `applyCorrelatedAttribution` in `attribution.util.spec.ts`.

**CONTEXT.md** gains **Declared Attribution** / **Correlated Attribution**. No
new ADR: ADR-0001 already records session-based correlation as a fallback for
callers that omit attribution, never as the primary source, and this is that.

Verified: `npm test` 178 passed (12 suites); `npm run test:e2e` 70 passed (5
suites); `tsc --noEmit` clean; eslint clean on every file touched. Pre-existing
lint failures in `inventory.service.spec.ts` / `order.service.spec.ts` are
untouched — note `npm run lint` runs `eslint --fix` and will reformat unrelated
files if run repo-wide.

**No migration.** The `correlated` value has been in the `attribution_source`
enum since ticket 02; this is the first code path that writes it.
