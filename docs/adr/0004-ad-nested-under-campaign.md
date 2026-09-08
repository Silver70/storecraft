---
status: accepted
---

# An Ad is nested under its Campaign, and resolved in a second pass

A Campaign is the thing a merchant funds; an Ad is one creative running under
it. We add Ads as a child of Campaign, matched on `utm_content`, and resolve
them in a second pass over the winning Campaign's own Ads — never in the same
contest as the Campaign rules that chose it.

## Considered options

Adding `utm_content` to the existing `FIELD_RANK` is one enum value and no new
code path. We rejected it because matching is first-match-wins over a single
flat order: an Ad rule would then be able to claim a tuple whose `utm_campaign`
names a different Campaign, moving revenue between Campaigns with nothing
thrown. It also forces Ad tags to be unique per Store, which forbids the thing
merchants actually do — calling the video variant `video-a` in every campaign.

Mirroring the ad platform's hierarchy in full (Campaign, then ad set, then ad)
was rejected because the middle level exists to hold budget and targeting, and
we do neither. A third level we cannot populate is a third level of empty UI. If
a sync ever supplies one, it belongs on the Ad as a label, not as a table.

## Consequences

Per-Ad reporting is retroactive. `utm_content` has been stamped on both touches
of every Order since ADR-0001, so the split applies to history on the day it
ships — unlike the Campaign spine, this feature is not racing any ad spend.

An Order that matches a Campaign and none of its Ads is Unassigned within that
Campaign: its own visible bucket, on the principle that already keeps
Unattributed visible at the Store level.

Ads are optional. Spend carries a nullable Ad, so a Campaign whose costs have
not been split still reports its own ROAS, and no synthetic "default Ad" is
invented to hold them — a fake row would sit in the card grid forever.

Per-Ad Spend can be synced from an ad platform. Per-Ad revenue cannot: only a
link carrying the Ad Tag joins a platform's ad to our Orders. The tag stays the
spine whether or not an integration exists.
