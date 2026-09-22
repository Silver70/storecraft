# 13: Verify what the provider's clicks figure counts

**What to build:** Certainty about one number. The conversion rate on the
campaign detail page is our Orders divided by the platform's clicks, and it is
only meaningful if those clicks are **link clicks** — people who reached the
store.

The vendor's documentation does not say which figure its `clicks` field carries.
The platform's own `clicks` metric counts likes, comments and taps that expanded
an image, alongside clicks on the link. If that is what we are storing, the
conversion rate is wrong by a wide margin on every campaign, and it will look
entirely plausible while being wrong — which is why this is a ticket rather than
a note.

This needs a real ad account that has actually delivered, so it cannot be done
against the fake provider.

**Blocked by:** 07

**Status:** ready-for-human

- [ ] On a real connected ad account with delivery, the clicks we store are
      compared against the platform's own reported link clicks and its all-clicks
      figure for the same ad and the same day
- [ ] The answer is recorded in the vendor reference notes, so nobody has to
      establish it twice
- [ ] If it is not link clicks, clicks are re-sourced from the figure that is,
      and the sync backfills the corrected figure for the days already stored
- [ ] The conversion rate's definition in the glossary and on the page still
      matches what is being divided
