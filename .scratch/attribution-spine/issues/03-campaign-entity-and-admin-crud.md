# 03: Campaign entity and admin management

**What to build:** A merchant can manage the things they spend money on. A new Marketing section in the admin sidebar lists Campaigns and lets the merchant create, edit and archive them.

A Campaign has a name, a platform, an optional ad-platform id for later reconciliation, and a status. On creation it receives a canonical tag slug derived from its name, unique within the Store, plus an implicit exact-match rule on that tag — so links generated from the Campaign always match it without the merchant authoring any rule.

Campaigns are managed objects with full CRUD, like Discounts, which is why they live in their own sidebar section rather than as another tab on the read-only Analytics page. Archiving keeps a finished Campaign out of the active list without losing its history. A Campaign can never be removed in a way that destroys the Orders it explains.

**Blocked by:** 01

**Status:** resolved

- [x] A merchant can create a Campaign with a name and platform and see it in a Marketing section of the sidebar
- [x] Creating a Campaign assigns a canonical tag slug that is unique within the Store
- [x] A newly created Campaign already matches its own canonical tag with no rule authored by hand
- [x] A merchant can edit a Campaign's name, platform and ad-platform id after creation
- [x] A merchant can archive a Campaign and it leaves the active list while remaining retrievable
- [x] Campaigns are visible only within the Organization and Store that own them
- [x] Campaign endpoints enforce the same admin permissions as other admin writes

## Comments

Implemented 2026-09-04.

**Schema.** Two tables, migration `0009_campaigns_and_matching_rules.sql`.
`campaigns` — name, canonical `tag`, platform, optional `external_id`, status,
`archived_at` — with `UNIQUE (store_id, tag)`, so tag uniqueness is guaranteed
by the database rather than by the read that preceded the insert.
`campaign_matching_rules` lands here too, ahead of ticket 04, because the
implicit rule is what makes a new Campaign match itself; 04 adds the merchant-facing
rule CRUD, normalization, and the matcher. A rule carries `is_canonical` so the
one created with the Campaign is distinguishable from a hand-authored one and can
be protected from deletion.

**The canonical tag never changes, including on rename.** A tag already pasted
into an ad platform cannot be recalled, so re-deriving it from a new name would
orphan every ad running under the old one. `tag` is therefore absent from the
update DTO entirely — `forbidNonWhitelisted` turns an attempt to send one into a
400 rather than a silent no-op, which the e2e suite asserts.

**Tag derivation is not `generateSlug`.** The shared slug helper strips
underscores outright, which is right for a product slug and wrong here:
"Summer_Sale" would become `summersale`, and a merchant hand-tagging
`utm_campaign=summer_sale` would silently land on nothing. `deriveCampaignTag`
maps every run of non-alphanumerics to one hyphen — the separator ticket 04's
matcher normalizes to — folds accents, and falls back to `campaign` when a name
slugifies to nothing. It is covered as a pure unit (10 tests) for the same reason
the matcher will be: a bad tag does not throw, it makes a Campaign look
unprofitable forever.

**There is no delete, only archive.** Attribution is resolved from a Campaign's
rules at read time (ADR-0001), so deleting a row would move revenue that has
already been reported into Unattributed behind the merchant's back. `DELETE
/api/admin/campaigns/:id` is not routed and returns 404; `POST :id/archive` and
`POST :id/unarchive` are the retirement path, and archiving is reversible.

**API.** `GET|POST /api/admin/campaigns`, `GET|PATCH /api/admin/campaigns/:id`,
`POST /api/admin/campaigns/:id/archive|unarchive`, all in a new `marketing`
module shaped like `analytics`. The list returns active campaigns by default —
`?status=archived` or `?status=all` for the rest. Guarded by the same
`AdminAuthGuard` + `RbacGuard` pair as every other admin write, under two new
permissions `campaigns.read` / `campaigns.write`, both granted to `super_admin`
and `product_manager` exactly as `discounts.*` are.

**Admin UI.** A new Marketing section in the sidebar with Campaigns under it,
plus `src/features/campaigns/` following the thin-route-plus-feature-folder
convention: list with Active/Archived tabs, create, and a detail page that edits
name/platform/ad-platform id, shows the canonical tag read-only with a copy
button and an explanation of why it is fixed, and archives or restores. Saving a
new campaign lands on its detail page, because the tag is assigned server-side
and is the thing the merchant needs next.

**Tests.** `test/admin-campaigns.e2e-spec.ts` (17 tests, seam 1) drives every
acceptance criterion through the real admin REST API against local Postgres:
creation and listing, the derived tag, `spring` / `spring-2` uniqueness within a
store and the same tag allowed in another store, the canonical rule as persisted,
editing, the tag surviving a rename, archive/restore and the absent delete,
isolation across an Organization boundary *and* across two stores of the same
Organization, and a support agent refused every verb.
`src/modules/marketing/utils/campaign-tag.util.spec.ts` covers the tag rules as a
pure unit. New harness pieces: `test/helpers/admin-fixture.ts` and
`admin-client.ts`, which seed an org, a store and admins holding real roles and
mint tokens through the real `AdminAuthService.login`. Admin users are global
identities that no Organization cascades to, so they are torn down explicitly and
the global-setup sweep now also clears any left behind by a crashed run, keyed on
a reserved `@e2e-test.invalid` domain.

Verified: `npm run test:e2e` 29 passed (4 suites); `npm test` 102 passed;
`tsc --noEmit` and eslint clean; frontend `npm run build` (which runs
`tsc --noEmit`) clean.

**Not applied to any deployed database.** The migration has only been applied to
the local test database by the e2e global setup — run `npm run db:migrate`
against dev and production before the admin UI is usable there.
