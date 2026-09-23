# 06: Server-side Purchase events

**What to build:** Every paid Order is reported to the platform from our server,
so the platform learns who actually buys instead of who clicks. The storefront's
pixel reports the same purchase from the browser; both carry the Order's id, so
the platform counts one purchase, and the server's copy is the one that survives
an ad blocker.

Purchases are sent for every paid Order, not only ones we credited to a Campaign,
because the platform does its own attribution and a partial picture teaches it
the wrong lesson.

Sending must never be able to fail a checkout. It is evidence, like attribution:
it is recorded, retried, and if the vendor is unreachable it stays queued rather
than surfacing to a customer.

**Blocked by:** 05

**Status:** resolved

- [x] An Order reaching a paid state dispatches one Purchase carrying its total,
      currency, id, and the customer's hashed email and phone
- [x] The browser's copy and the server's copy carry the same Order id as the
      event id, so the platform counts one purchase
- [x] Meta's browser identifiers frozen on the Order are included when present
- [x] Dispatch state is recorded per Order with an attempt count and the last
      error
- [x] A failed dispatch is retried by the scheduled job; a successful one is
      never sent twice, including when the job runs repeatedly
- [x] A vendor failure never propagates into checkout, and never leaves an Order
      unpaid or a cart stuck
- [x] A Store with no connection dispatches nothing and queues nothing
- [x] With the consent switch on, no Purchase is dispatched for a customer who
      did not accept — an IP address and a hashed email are personal data too
- [x] A refunded Order is not retracted, and the reason is recorded in the code
      where someone would otherwise add it
- [x] An end-to-end spec proves one Order produces exactly one dispatch, that a
      failure is retryable, and that a checkout survives a dead provider

## Comments

Done. Backend `tsc`, `nest build`, `npm test` (232 unit specs) and the new
`purchase-events.e2e-spec.ts` (22 specs) are green, as are the storefront
`vitest` run (78 specs) and both app builds. `npm run test:e2e` has 168 passing
and one failure — `inline-edit.e2e-spec.ts`, the same assertion tickets 01–05
each recorded, which asserts an exact object that has since gained
`canEditContent`. It does not touch purchases. `npm run lint` reports only the
same 7 pre-existing `unbound-method` errors in `inventory.service.spec.ts` and
`order.service.spec.ts`.

Every paid Order is reported through `sendPurchase` on the provider interface,
implemented against `POST /v1/ads/conversions` with the Store's own scoped key
and the connection's Pixel as the destination. The browser's copy is
`trackPurchase` on the confirmation page. Both carry the Order's id.

Judgement calls not on the checklist:

**The customer's details are sent to the vendor in plaintext, and the vendor
hashes them.** The checklist says "the customer's hashed email and phone", and
what reaches Meta is a SHA-256 digest — but the hashing is the vendor's, not
ours. Their conversions API documents plaintext in and hashing per Meta's spec
before anything leaves them, so a value we hashed first would be hashed again and
match nobody: the purchase would arrive, be attributed to no person, and the
feature would look like it worked. This is the one shape in the codebase that
carries a customer's email and phone across a network boundary, and
`zernio.adapter.ts` says so at the method rather than leaving it to be noticed.
Normalization is ours — lowercased email, collapsed phone — because a hash is
unforgiving about case and the vendor documents only Gmail's rules.

**No IP address and no user agent are sent.** Both are high-signal match keys and
Meta asks for them; neither is on the Order, and a dispatch that runs an hour
later has no request to read them from. Adding columns for them would mean
holding two more pieces of personal data on every Order for the benefit of a
report — the opposite of the direction the consent bullet points in. The
identifiers we do send are the ones already frozen for this purpose.

**The scheduled pass finds paid Orders, not only queued ones.** The listener that
fires when an Order is paid is detached, so a restart between the payment and the
handler would lose a sale's report entirely if the queue were the only record.
`findDue` left-joins the dispatch row and picks up paid Orders that have none, so
the queue is self-healing and the listener is latency rather than bookkeeping.
The e2e spec deletes a row and proves the pass reports it anyway.

**Claiming is one SQL statement, and that is what "never sent twice" rests on.**
Two writers can want the same Order at the same moment — it has just been paid
and the job is running. `INSERT … ON CONFLICT DO UPDATE … WHERE` decides between
them in the database: whoever gets a row back owns the send, whoever gets nothing
does nothing. The `WHERE` also carries a ten-minute lease on the last attempt, so
a claim still in flight is not taken over, and a failure is retried on the next
hourly pass rather than ten times inside one. Meta would deduplicate a double
send on the event id anyway; what the claim protects is our own record of what
was reported, which is the only thing that knows.

**A dispatch expires after seven days rather than retrying forever.** Meta's
click attribution window is seven days and an event arriving after it is accepted
and attributed to nobody — so past that line a dispatch is a customer's contact
details sent to an ad platform in exchange for nothing. `expired` is a recorded
state rather than a sweep, so a queue that stopped draining is legible instead of
merely empty.

**A withheld purchase is a row, not an absence.** A Store that asks for consent
and a visitor who did not give it produce a `withheld` dispatch, so "nothing was
sent" is a decision on the record and the job stops reconsidering an answer that
cannot change. A Store with **no connection** produces no row at all, as the
checklist asks: there is no ledger of purchases owed to nobody.

**An Order keyed in by an admin as already paid is reported too.** It is a paid
Order and the ticket says every one. It arrives by `order.created` rather than
`order.status_changed`, because an Order created paid is never flipped — listening
to the transition alone would silently never report a phone sale. Its
`actionSource` is `system_generated` rather than `web`: a phone sale reported as a
website purchase costs match quality without anybody noticing.

**A refunded Order is reported when the refund beat the dispatch.** Not only "not
retracted": if the send was still owed when the refund landed, it is still sent.
The sale happened, the browser's copy has already arrived, and withholding the
server's copy now would leave the platform holding half a purchase rather than
none. `NO_RETRACTION` in `purchase-dispatch.util.ts` is the constant somebody
would delete to add a retraction, and it says why there is none.

**Nothing about dispatch is surfaced in the admin.** The state, the attempt count
and the last error are recorded for an engineer. A shopper's purchase being slow
to reach an ad platform is not something a merchant can act on, and a panel
showing it would invite them to try.

**The browser's copy is gated on the pixel being loaded, not only on consent.**
Effects run leaf-first, so the confirmation page can reach `trackPurchase` a beat
before the root has initialised the pixel. Marking the Order reported there would
have made it the one purchase the browser never sends, so nothing is remembered
until something was actually reported. `contents` is keyed by SKU, which is what
a merchant's catalog at the platform is keyed by; a line without one is left out
rather than sent with an empty id.

**Deployment needs `npm run db:migrate`** for `0028_server_side_purchase_events`
— a new enum and a new table, additive, nothing altered. It has been applied to
the local test database by the e2e suite's global setup and **not** to the hosted
one.

**Still to confirm against a live account**, as tickets 07 and 13 already record
for the read direction: nothing here has been exercised against a real Zernio
account, because the configured one still has no connected accounts. The two
things a live run would settle are that `eventsReceived`/`eventsFailed` come back
on the shape the adapter reads, and that Meta's Event Match Quality
(`GET /v1/ads/conversions/quality`) actually sees the browser and server copies
deduplicating — which is the only external proof that one purchase is being
counted once.

`CONTEXT.md` gains **Purchase Dispatch**, and **Purchase Event** gains the
sentences about what it carries and about refunds.
