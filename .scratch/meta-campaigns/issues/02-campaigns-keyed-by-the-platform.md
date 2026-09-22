# 02: Campaigns and Ads keyed by the platform, credited by the latest ad click

**What to build:** The new spine. A Campaign stops being our own record with a
tag and becomes one campaign on an ad platform, identified by the platform's own
campaign id; an Ad likewise. An Order finds them by the ids the platform wrote
into the click, so nothing depends on a merchant typing a tag correctly, and a
rename can never break reporting.

Credit goes to the **latest ad click**: the Order's last touch if it names a
Campaign, otherwise its first touch if it does. An untagged visit after an ad
click — a search for the store's name, a bookmark — must not cancel the ad's
credit. This rule is written once and every report reads it from there.

Nothing syncs yet and nothing can be created yet, so this ticket is proved
against seeded rows. The per-Ad daily figures table arrives here, empty, so that
the report has its shape before ticket 07 fills it.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A Campaign carries the platform's campaign id, unique per Store, its
      platform, its status as the platform reports it, its schedule and a cover
- [ ] An Ad carries the platform's ad id, unique per Store, its campaign, its
      format, its status and its creative
- [ ] Both carry a flag recording whether the platform's own link tags are
      present on the Ad, defaulting to absent
- [ ] Campaign Tags, Ad Tags, matching rules, the rule matcher, the value
      normalizer and the rule controllers are deleted
- [ ] The campaign platform vocabulary loses every non-paid value; only ad
      platforms remain
- [ ] The merchant-owned `archived` status and the archive/unarchive paths are
      gone from Campaign and Ad; status comes from the platform
- [ ] A table holds spend, impressions and clicks per Ad per day, spend in minor
      units, unique on the Ad and the day
- [ ] An Order whose last touch carries a campaign id and an ad id credits that
      Campaign and that Ad
- [ ] An Order whose last touch names no Campaign but whose first touch does
      credits the Campaign named by the first touch
- [ ] An Order whose touches name no Campaign at all is Unattributed and is
      still counted in the store's totals
- [ ] An Order that names a Campaign but none of its Ads counts toward the
      Campaign and is reported on its own line, never spread across the Ads
- [ ] Ad-level revenue and order counts sum exactly to their Campaign's
- [ ] The credit rule exists in exactly one place and is unit-tested directly,
      including both touches naming different Campaigns
- [ ] Reading a Campaign or its figures from another Organization is impossible
