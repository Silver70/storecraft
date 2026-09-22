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

**Status:** ready-for-agent

- [ ] A Not Tracked campaign offers Start tracking on its detail page; a Tracked
      one does not
- [ ] Pressing it explains, before anything happens, that the platform will
      re-review the ads and that ads made from existing posts lose that post's
      engagement
- [ ] Confirming writes our link tags to every ad in the campaign that can take
      them
- [ ] An ad that cannot be retagged is reported by name with the reason, and
      does not prevent the others from being tagged
- [ ] The campaign becomes Tracked only when every ad carries the tags
- [ ] Tags already present are not rewritten, so a repeat press is harmless
- [ ] Revenue from clicks after tagging credits the campaign and the right ad;
      revenue from clicks before it stays unmeasurable and is not backfilled
- [ ] The action requires `campaigns.write`
- [ ] A vendor failure leaves the campaign Not Tracked and says so, rather than
      claiming success
