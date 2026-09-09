# 01: Ad as a managed object

**What to build:** A merchant can subdivide a Campaign into the individual
creatives running under it. They create an Ad, give it a name, set the dates it
runs between, rename it, and archive it when it is finished. Each Ad is listed
under its Campaign in the admin, and each one is born already carrying the
canonical Ad Tag that will later let its Orders find it.

Nothing is attributed to an Ad yet and no cost can be recorded against one — this
ticket establishes the noun and the tag, and nothing more. What it proves is that
a merchant can express "these four creatives are one push" in the system at all.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A merchant creates an Ad under a Campaign with a name, and optionally a
      start and an end date; both dates are optional and either may be set alone
- [x] The Ad is created already owning a canonical Matching Rule on its own Ad
      Tag, on the `utm_content` field, in the same way a Campaign is created
      owning a rule on its Campaign Tag
- [x] The Ad Tag is derived from the name using the same derivation the Campaign
      Tag uses, so both sides of a later comparison normalize identically
- [x] The Ad Tag is unique within its Campaign and **not** within the Store: two
      Campaigns may each own an Ad tagged `video-a`, and both are accepted
- [x] The database is the authority on that uniqueness, not the read that
      preceded the insert — two admins naming an Ad the same thing at the same
      moment must not both win
- [x] Renaming an Ad leaves its Ad Tag unchanged, because a link already running
      in an ad platform cannot be recalled
- [x] The canonical rule is not merchant-deletable, for the same reason
- [x] **The Campaign matcher never reads `utm_content`.** Adding the field to the
      rule-field vocabulary must not make it a field the Campaign resolution
      ranks or compares. This is the guarantee ADR-0004 exists for: a rule on
      `utm_content` must be structurally incapable of deciding which Campaign an
      Order belongs to
- [x] Existing Campaign resolution is unchanged — the same tuples resolve to the
      same Campaigns as before this ticket, proven by the existing matcher specs
      continuing to pass untouched
- [x] An Ad can be archived, and an archived Ad is kept out of the active list
      without losing the history that will later explain Orders
- [x] Archiving a Campaign archives its Ads
- [x] Restoring a Campaign does **not** restore its Ads — the merchant
      re-activates them deliberately
- [x] There is no way to delete an Ad, for the reason ADR-0002 gives for
      Campaigns: revenue already reported against it would be silently re-bucketed
- [x] An Ad is scoped to its Organization and Store like every other
      tenant-scoped record, and an Ad id belonging to another Organization does
      not resolve
- [x] A merchant sees a Campaign's Ads listed on the Campaign detail page, with
      an unremarkable state for a Campaign that has none — an Ad is a
      subdivision a merchant opts into, and a Campaign without one is not
      incomplete
- [x] Ad management is covered end to end over real HTTP with a real admin token
      and store header, alongside the existing Campaign coverage

## Comments

Implemented 2026-09-09.

**The entity.** A new tenant-scoped `ads` table (migration
`0013_ads_and_ad_matching_rules`) carrying `organization_id` as its second
column, plus `store_id` and `campaign_id`, with name, tag, `external_id`,
nullable `starts_at` / `ends_at`, status and `archived_at`. It reuses the
`campaign_status` enum rather than declaring a second one, because an Ad's
statuses are the Campaign's and exist for the same reason. It has no `platform`
— that stays on the Campaign per ADR-0002. The creative reference is left to
ticket 04, which brings the storage wiring it needs. The unique constraint is
`ads_campaign_tag_unique` on `(campaign_id, tag)`, so two Campaigns may each own
a `video-a`.

**Tag derivation is shared, not copied.** `deriveCampaignTag` gained an optional
fallback word and is called with `AD_TAG_FALLBACK` (`ad`), so both sides of a
later comparison normalize identically and an emoji-named creative is not tagged
`campaign`.

**ADR-0004, enforced structurally rather than by convention.** `utm_content` is
now in the `campaign_rule_field` enum, and `FIELD_RANK` in
`campaign-matching.util.ts` is the sole definition of what Campaign resolution
reads: `createCampaignMatcher` drops every rule whose field it does not rank,
before anything is sorted. Handing the Campaign matcher an Ad rule therefore
cannot change its answer, whatever the caller does. Three further layers agree
with it — `findMatchableRules` filters `ad_id IS NULL`, the campaign rule DTO and
the rule-preview DTO offer only `CAMPAIGN_MATCH_FIELDS`, and `findRuleById` /
`deleteRule` refuse an Ad's rule id — but the matcher's own filter is the one
that does not depend on a caller behaving. `AttributionTuple` gained
`utmContent`, which the Campaign matcher never reads; the second-pass Ad matcher
is ticket 03's.

**Archiving.** `CampaignService.archive` cascades in one statement, skipping Ads
already archived so their own retirement date is not rewritten. `unarchive`
deliberately does not cascade. There is no delete endpoint at either level.

**A latent bug fixed on the way.** Drizzle wraps every failed query in a
`DrizzleQueryError` carrying the driver error as `cause`, so the existing
`error.code === '23505'` check in `CampaignService` was always false — the tag
retry it guarded could never fire, and a lost race would have surfaced as a 500.
That is exactly the "database is the authority" property this ticket asks for, so
it is now a shared `isUniqueViolation` in `src/shared/database/db-error.util.ts`
that walks the cause chain, used by both services and covered by its own spec.

**Admin API.** `AdminAdController` under `admin/campaigns/:campaignId/ads`,
reusing the existing `campaigns.read` / `campaigns.write` permissions rather than
introducing a new pair. Every read and write names the Campaign as well as the
Ad, so an id from another Organization — or from a sibling Campaign — is a 404.

**Frontend.** An `AdsCard` on the Campaign detail page lists the Campaign's Ads
with their tag, flight dates and status, and creates, renames, archives and
restores them. The empty state is deliberately unremarkable — it says a Campaign
without Ads reports exactly as it does now rather than prompting for one. The
route loader prefetches the list alongside the rules. The card grid is ticket 05.

**Verification.** Backend `tsc --noEmit` and ESLint clean; the unit suite passes
at 284 tests, including six new matcher cases for the ADR-0004 property, one for
the shared tag derivation and six for the unique-violation helper. Frontend
`tsc --noEmit` clean and the new file Prettier-formatted.

The integration suite ran against a local PostgreSQL 18: **209 of 210 pass**,
with `admin-campaigns.e2e-spec.ts` at 72 of 72 — 32 of them new, covering
creation, the canonical `utm_content` rule, per-Campaign tag uniqueness with two
Campaigns each owning a `video-a`, the unique index refusing a duplicate written
straight at the table, rename leaving the tag fixed, flight dates including a
backwards one, the archive cascade and the non-cascading restore, the absence of
a delete at both the Ad and the rule, tenancy across Organizations and Stores and
sibling Campaigns, and Campaign resolution being unchanged by the presence of
Ads. Migration `0013` applied cleanly — its `ALTER TYPE ... ADD VALUE` is fine
inside the migrator's transaction because nothing in the same migration uses the
new value — and the database was inspected afterwards to confirm the `ads` table,
the appended enum label, the nullable `ad_id`, and
`ads_campaign_tag_unique UNIQUE (campaign_id, tag)`.

Running the suite needed an `apps/backend/.env.test`, which was missing from the
repo despite being the file `loadTestEnv()` reads; it is now committed, holding
throwaway secrets and a local database URL, with machine-specific credentials
left to the gitignored `.env.test.local`.

**The one failure is pre-existing and unrelated.**
`inline-edit.e2e-spec.ts` asserts the inline-edit config response equals exactly
`{storefrontUrl, canEditProducts}`, but `canEditContent` was added to that
response in `2e9714e` (homepage hero as a content slot) without the test being
updated. Both the controller and that spec are untouched by this ticket. It
belongs to the content-slot work, not here.

**Not verified:** the admin UI was not exercised in a browser.
