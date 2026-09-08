# 05: Platform State and Placement

**What to build:** The merchant finds out from their own dashboard that the
platform rejected an ad. The platform's own view of an Ad — approved, rejected,
in review, delivering, paused — lands beside ours and never touches it. So does
the placement the ad ran in, as a label the merchant will recognise.

The payoff is one specific card: an Ad that is Active here and rejected there.
That card only exists if neither value is allowed to overwrite the other, and it
is the card that saves a merchant a week of wondering why a Campaign stopped
producing.

**Blocked by:** 03 (Unlinked Ads: claim and dismiss).

**Status:** ready-for-agent

- [ ] An Ad carries a Platform State, written only by the sync and absent for
      anything not synced
- [ ] **Platform State never overwrites an Ad's own status.** They are two
      independent facts displayed together; an ad paused or rejected at the
      platform must not disappear from the merchant's active list along with its
      history
- [ ] An Ad's own status is never written by the sync under any circumstance
- [ ] An Ad that is Active here and rejected at the platform is readable as both
      at once, and reads as a problem to act on rather than as a contradiction
- [ ] An Ad carries a Placement, written only by the sync and absent otherwise
- [ ] **Placement is a recognition label only** — not a dimension anything is
      reported by, filtered by or grouped by, because one ad runs in several
      placements at once and treating it as a dimension makes it a many-to-many
- [ ] An Ad with no Placement renders without an empty badge
- [ ] Both fields are cleared or preserved deliberately when a platform stops
      reporting an ad, and the chosen behaviour is stated rather than incidental
- [ ] Covered end to end: a sync sets Platform State without changing the Ad's
      status, and the Active-here-rejected-there case is asserted
