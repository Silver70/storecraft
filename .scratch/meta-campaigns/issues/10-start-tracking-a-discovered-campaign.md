# 10: Start tracking a discovered campaign

**What to build:** The one action that turns a campaign built in Ads Manager
from "spending money we cannot measure" into a measured one. The merchant presses
it on the campaign's page, and the link tags that make revenue attributable are
written onto every one of its ads.

This costs the merchant something, so it is never done for them. The platform
treats a tag change as a new creative: the ad goes back through review, and an ad
built from an existing Facebook or Instagram post loses that post's accumulated
likes and comments. The merchant must be told that before they agree, not after.

Some ads cannot be retagged at all. That is reported per ad, and the ads that
could be are still done.

**Blocked by:** 09

**Status:** resolved

- [x] A Not Tracked campaign offers Start tracking on its detail page; a Tracked
      one does not
- [x] Pressing it explains, before anything happens, that the platform will
      re-review the ads and that ads made from existing posts lose that post's
      engagement
- [x] Confirming writes our link tags to every ad in the campaign that can take
      them
- [x] An ad that cannot be retagged is reported by name with the reason, and
      does not prevent the others from being tagged
- [x] The campaign becomes Tracked only when every ad carries the tags
- [x] Tags already present are not rewritten, so a repeat press is harmless
- [x] Revenue from clicks after tagging credits the campaign and the right ad;
      revenue from clicks before it stays unmeasurable and is not backfilled
- [x] The action requires `campaigns.write`
- [x] A vendor failure leaves the campaign Not Tracked and says so, rather than
      claiming success

## Comments

Done. Backend `tsc`, `npm test` (486 unit specs), the new
`campaign-tracking.e2e-spec.ts` (12 specs) and the three neighbouring e2e specs
are green, `eslint` is clean over everything touched, and the frontend build
(`vite build && tsc --noEmit`) passes. The UI is untested, per the spec's
testing floor. Nothing ran against a live account. The full e2e run has one
failure, `inline-edit.e2e-spec.ts` (`canEditContent`), the same pre-existing one
earlier tickets recorded.

**Endpoint:** `POST /api/admin/campaigns/:id/tracking` (`campaigns.write`),
served by `CampaignTrackingService` in the ad-platform module. It answers 200
with a result per ad (`tagged`, `already_tagged`, `refused` with a reason,
`not_attempted`), a `tracked` flag read back after the run, and a `message`
when the platform failed part-way. 404 for another store's campaign. 409 when
Meta is disconnected, or when the same campaign is already being tagged.

**The seam grew one method, `writeLinkTags`.** The adapter calls
`PATCH /v1/ads/{adId}/tracking-tags` with `urlTags` only. Per the vendor's
OpenAPI spec, that copies the existing creative exactly and adds the tags. The
optional `creative` body, which rebuilds the ad from fields we supply, is never
sent. The vendor answers 422 for creatives it cannot copy (page posts,
Instagram posts, dark posts, placement-customised). Those are reported per ad
as "made from an existing post", and nothing is built for them. 404 (deleted)
and 405 (no click-URL surface) are also per-ad refusals. Anything else throws
and stops the run. The contract spec, the fake and the adapter spec all cover
it.

Judgement calls:

- **Each ad's tags are re-read just before writing.** The stored flag can be
  up to an hour old. An ad the merchant tagged by hand in the meantime is
  recorded as tagged, not rebuilt. This costs one read per untagged ad, and it
  is what makes a repeat press harmless even against a stale row.
- **Ours are merged into the merchant's tags, not written over them.** A write
  replaces the whole set, so the merchant's other parameters are kept
  (`mergeLinkTags`, unit-tested). The two join parameters are always ours.
  `utm_source`/`utm_medium` are only added where absent, since nothing joins on
  them.
- **A platform failure stops the run** rather than trying the next ad, as the
  sync does for tag reads (shared quota). Ads already tagged stay recorded. The
  rest read "not tagged yet", and the campaign stays Not Tracked. Pressing
  again finishes the job without touching the tagged ones. The message never
  blames the merchant's account.
- **A sync runs right after any ad is tagged**, so tagged ads show their new
  In review status now rather than within the hour. It reports rather than
  throws, so it cannot fail the action.
- **A double press is guarded in-process only** (a per-campaign in-flight set).
  Two API instances could still both tag one campaign. The second would re-read
  and find most ads already tagged, so the likely cost is at most one extra
  review per ad caught mid-flight.
- **Tracked stays strict: every ad, deleted ones included**, as ticket 07 left
  it. A deleted ad cannot be retagged (the vendor 404s). It is reported by
  name as "Meta no longer has this ad", and its campaign can never become
  Tracked. If that turns out to be common, change the one query in
  `refreshTracked` to ignore deleted ads. That needs a column for "deleted",
  because deleted and schedule-ended ads both collapse to `ended` today.
- **No backfill, by construction.** Orders from before tagging carry no
  platform ids, so they stay unattributed. The e2e proves both halves: a
  pre-tag order stays unattributed, and a post-tag click credits the campaign
  and the right ad. A period that straddles the tagging date shows spend from
  before and revenue only from after. Nothing on the page says when tracking
  started. Worth adding if merchants misread the first month's ROAS.

**UI:** a Not Tracked campaign's detail page shows an amber "Not tracked"
banner with Start tracking. A Tracked one shows neither. The button opens a
dialog that states the three costs before anything is sent: re-review, lost
engagement on post-based ads, no backfill. After it runs, the dialog lists
each ad with its result and any reason. It only says "now tracked" when the
server's `tracked` is true.

**Still to confirm against a live account:** that a 422 is what the vendor
really returns for a post-based ad when `creative` is omitted (the spec says
so). And that the PATCH response's `urlTags` carries the macros unexpanded, as
the adapter's `not_applied` check assumes.
