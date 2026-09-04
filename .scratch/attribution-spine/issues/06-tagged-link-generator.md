# 06: Tagged link generator

**What to build:** A merchant can get a correctly tagged URL out of the admin instead of composing UTM parameters by hand, so matching is exact by construction and typos become impossible.

The merchant picks a Campaign, a destination page on their Store, and a source and medium, and gets a complete URL using the Campaign's canonical tag. One click copies it, ready to paste into an ad platform. Several links can be generated for one Campaign differing by source or medium, so the same push running on more than one platform still reports as a single Campaign.

The generator is a convenience, not a precondition — links tagged by hand before a Campaign existed remain claimable by a matching rule.

**Blocked by:** 03

**Status:** resolved

- [x] A merchant can generate a tagged URL for a Campaign, choosing destination page, source and medium
- [x] The generated URL uses the Campaign's canonical tag
- [x] A generated link's traffic attributes to its Campaign with no additional rule authored
- [x] Several links differing only by source or medium all attribute to the same Campaign
- [x] The generated URL can be copied in one action
- [x] The destination can be any page of the Store, not only the home page

## Comments

Implemented 2026-09-04.

**The tag is not an input.** `GET /api/admin/campaigns/:id/link` takes a
destination, a source, a medium and an optional content label; `utm_campaign`
comes from the Campaign the link is generated for. That is the whole feature —
the one value attribution depends on is the one value the merchant never types.
Guarded by the existing `campaigns.read` permission, so a support agent is
refused the generator exactly as they are refused everything else marketing.

**Composition is a pure unit, for the same reason matching is.** A link that
goes out carrying the wrong tag does not throw; it makes a Campaign look
unprofitable for as long as the ad runs. `utils/tagged-link.util.ts` is
`buildTaggedLink(input) → { ok, link } | { ok: false, problem }` with no
database, framework or clock in it, and its spec (21 cases) closes with the
property the feature exists for: links built for a Campaign are claimed by that
Campaign's own canonical rule, asserted against the real matcher rather than
only at the far end of a checkout.

**Parameter values are emitted through `normalizeMatchValue`** — the matcher's
own reduction, not a second slugifier. Source and medium therefore go out in
exactly the form both sides of a comparison are reduced to, which is why a
generated link cannot drift from the rule that claims it. The tag itself is
emitted verbatim: the canonical rule stores it that way too, so passing it
through unchanged is what keeps the pair identical.

**`utm_*` already on a destination is replaced, not appended.** Destinations get
pasted back out of an ad platform still tagged for whatever ran last, and a URL
holding two `utm_campaign` values attributes to whichever one the storefront
reads first. Everything else the destination carries is kept, including its query
string and fragment, because a link to one variant of a product anchored at its
reviews is exactly what sending an ad deep means.

**A destination is a path or a full `http(s)` URL, and nothing else.** Another
scheme (`javascript:`, `mailto:`) is a 400. A host-shaped value like
`//evil.test/landing` is treated as the path it literally is rather than
resolved as a protocol-relative URL, so a typo can never quietly retarget a
Campaign's traffic at a domain the merchant does not own.

**Nothing is stored.** A link is derived from the Campaign, so generating the
same one twice gives the same URL, there is no table of links to keep in step
with a renamed Campaign, and a link tagged by hand before its Campaign existed
is still claimable by a rule. The generator stays a convenience.

**Path destinations resolve against `STOREFRONT_URL`, not a per-Store domain.**
This is the known limitation. `stores` has no storefront URL column, and adding
one would mean a migration plus a store-edit surface that does not exist yet —
out of scope here. A Store on its own domain is served today by pasting an
absolute URL as the destination, which the generator accepts and tags. Worth
revisiting when a second Store in one Organization needs its own domain.

**Admin UI.** A Tagged Link card on the campaign detail page,
`src/features/campaigns/components/tagged-link-card.tsx`: destination, source,
medium, optional creative label, and the finished URL with a one-click copy. The
URL is composed by the backend on a debounced query rather than in the browser —
a second implementation of the composition would be free to drift from the one
the rule was written against. Source and medium are prefilled from the
Campaign's platform (`PLATFORM_LINK_DEFAULTS`), `other` deliberately blank. The
card says outright that generating several links differing by source or medium
reports as one Campaign, since that is the thing a merchant would otherwise
solve by creating three Campaigns. `CopyTagButton` generalized to `CopyButton`,
which now serves the tag and the link.

**Tests.** `tagged-link.util.spec.ts` (21 tests, seam 2): the tag carried
verbatim, source and medium in normalized form, optional content, home and deep
destinations, a path without a leading slash, an absolute URL, query and
fragment preserved, stale `utm_*` replaced, every refusal, and the
matcher-round-trip property. `test/admin-campaigns.e2e-spec.ts` gains a
`tagged links` block (11 tests, seam 1) driving the real admin API: the shape of
a generated URL, the canonical tag, a link matching with only the rule the
Campaign was born with, three links differing by source and medium resolving to
one Campaign, deep destinations, refusals, generation being repeatable, archived
Campaigns still generating, and the Organization boundary — plus the support
agent refused the new verb. `test/campaign-revenue.e2e-spec.ts` gains two tests
that run the full claim: generate a link, land a visitor with exactly the
parameters it carries, check out, and read the money back on that Campaign's
line, with nothing retyped in between.

`.env.test` now sets `STOREFRONT_URL=https://storefront.test`, deliberately not
localhost, so a test asserting on a generated link proves the configured
storefront was used rather than a default.

**CONTEXT.md** gains **Campaign Tag** and **Tagged Link**.

Verified: `npm test` 176 passed (12 suites); `npm run test:e2e` 63 passed (5
suites); `tsc --noEmit` clean; eslint clean on the touched backend files;
frontend `npm run build` (which runs `tsc --noEmit`) clean. Pre-existing lint
failures in `inventory.service.spec.ts` / `order.service.spec.ts` and the
pre-existing prettier warning on `matching-rules-card.tsx` are untouched.

**No migration.** Nothing here changes the schema.

**Still storefront-dependent for the last mile.** A generated link only becomes
attribution once a storefront reads the parameters off the landing URL and
passes them to cart creation. The Starter Storefront doing that is ticket 08;
until then the contract is what the e2e tests drive.
