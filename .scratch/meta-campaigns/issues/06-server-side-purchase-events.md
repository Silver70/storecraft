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

**Status:** ready-for-agent

- [ ] An Order reaching a paid state dispatches one Purchase carrying its total,
      currency, id, and the customer's hashed email and phone
- [ ] The browser's copy and the server's copy carry the same Order id as the
      event id, so the platform counts one purchase
- [ ] Meta's browser identifiers frozen on the Order are included when present
- [ ] Dispatch state is recorded per Order with an attempt count and the last
      error
- [ ] A failed dispatch is retried by the scheduled job; a successful one is
      never sent twice, including when the job runs repeatedly
- [ ] A vendor failure never propagates into checkout, and never leaves an Order
      unpaid or a cart stuck
- [ ] A Store with no connection dispatches nothing and queues nothing
- [ ] With the consent switch on, no Purchase is dispatched for a customer who
      did not accept — an IP address and a hashed email are personal data too
- [ ] A refunded Order is not retracted, and the reason is recorded in the code
      where someone would otherwise add it
- [ ] An end-to-end spec proves one Order produces exactly one dispatch, that a
      failure is retryable, and that a checkout survives a dead provider
