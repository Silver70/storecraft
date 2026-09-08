# 02: Sync Reported Figures

**What to build:** A scheduled job pulls what the ad platform knows. For each
connected Store it reads the ad tree and records, per platform ad per day, what
the platform says was spent, shown, clicked and converted, plus the platform's
own reported revenue and ROAS. On a first connection it backfills the history the
platform offers, so the feature is useful on day one.

Figures are keyed by the **platform's ad id**, not by one of our Ads. Nothing is
linked yet — that is ticket 03 — and keying it this way is what lets a claim
later attach history for free rather than needing a second pass.

A merchant can see when the last sync succeeded, and can see when one failed.

**Blocked by:** 01 (Connect a Store to an ad platform).

**Status:** ready-for-agent

- [ ] A scheduled job pulls the ad tree per connected Store, using the scheduling
      the reservation-expiry, low-stock and analytics rollup jobs already use
- [ ] The sync is a plain public method the schedule calls, so it can be invoked
      directly without involving the scheduler
- [ ] Reported Figures are stored per platform ad per day, carrying spend,
      impressions, clicks, conversions, the platform's reported revenue and its
      own ROAS, with the source and the currency denormalized onto the row
- [ ] **Reported Figures are never written into `campaign_spend`.** That table is
      the merchant's book of record; this one is the platform's (ADR-0005)
- [ ] A first connection backfills the history the platform offers rather than
      starting from today
- [ ] **The sync is idempotent.** Running it twice over the same range produces
      the same rows, not doubled ones — proven by test
- [ ] **Money is converted to minor units in the adapter, at the edge.** The
      vendor reports decimal amounts, and whole currency units for budgets,
      against this codebase's integers-only rule. The rounding rule is explicit
      and tested at boundary values, and no float reaches a service, a repository
      or a report
- [ ] A figure in a currency other than the Store's is stored as **that**
      currency. There is no conversion anywhere, and no exchange rate is fetched,
      inferred or hard-coded (ADR-0005)
- [ ] The last successful sync time is recorded per connection and shown to the
      merchant, so a stale figure is legibly stale
- [ ] **A provider failure is logged and surfaced on the page, never thrown into
      a merchant's read path.** A vendor outage costs freshness, not the
      dashboard
- [ ] Previously pulled figures stay readable through a failed sync
- [ ] The sync backs off rather than retrying hard. Some upstream quotas are
      shared across all of the vendor's customers and cannot be bought out of, so
      a refusal may have nothing to do with this Organization — and the message a
      merchant sees must not blame their own account
- [ ] A merchant can trigger a sync by hand without waiting for the schedule
- [ ] Reported Figures are scoped to their Organization and Store
- [ ] Covered by a new end-to-end spec: the fake provider returns a tree, the real
      sync runs against a real database, and the merchant reads the result back
      through the admin API
- [ ] **Do not test that the schedule fires.** That is the framework's behaviour,
      not ours
