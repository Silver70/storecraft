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

**Status:** resolved

- [x] An Ad carries a Platform State, written only by the sync and absent for
      anything not synced
- [x] **Platform State never overwrites an Ad's own status.** They are two
      independent facts displayed together; an ad paused or rejected at the
      platform must not disappear from the merchant's active list along with its
      history
- [x] An Ad's own status is never written by the sync under any circumstance
- [x] An Ad that is Active here and rejected at the platform is readable as both
      at once, and reads as a problem to act on rather than as a contradiction
- [x] An Ad carries a Placement, written only by the sync and absent otherwise
- [x] **Placement is a recognition label only** — not a dimension anything is
      reported by, filtered by or grouped by, because one ad runs in several
      placements at once and treating it as a dimension makes it a many-to-many
- [x] An Ad with no Placement renders without an empty badge
- [x] Both fields are cleared or preserved deliberately when a platform stops
      reporting an ad, and the chosen behaviour is stated rather than incidental
      — **preserved**, and dated by `platform_reported_at` so a stale claim
      reads as stale. An ad leaves a tree for reasons that are not facts about
      the ad (it fell outside the window asked for, a quota refusal truncated
      the answer, the account was disconnected), so clearing on absence would
      flicker the card against the sync's luck. The one thing that does clear
      both is an Ad ceasing to claim a platform ad at all
- [x] Covered end to end: a sync sets Platform State without changing the Ad's
      status, and the Active-here-rejected-there case is asserted
