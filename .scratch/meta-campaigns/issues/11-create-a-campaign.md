# 11: Create a campaign

**What to build:** A merchant builds and launches a campaign without leaving this
admin: a name, a daily budget, the dates it runs, the countries and ages to reach,
and one to six ads — each an image or video, some copy, a button and a
destination on their own storefront. They press Publish, and it is live at the
platform, or Save as paused and it waits.

The point of this ticket is not the form. It is that a campaign created here is
**measurable from birth**: the link tags carrying the platform's campaign and ad
ids are written in the same call that creates the ads. If that is ever skipped,
this feature produces a page of spend with no revenue beside it, which is worse
than what it replaced. Build it tags-first.

Images come from the product catalog as well as from an upload, because the
system already holds the photographs the merchant would otherwise export and
re-upload.

What is not on the form is deliberate: the goal is always Sales, placements are
automatic, bidding is the platform's default, and there is exactly one ad set
with the budget on the campaign. A merchant is not made into a media buyer.

**Blocked by:** 03, 08

**Status:** resolved

- [x] A merchant creates a campaign with a name, a daily budget in the Store's
      currency, a start date and an optional end date
- [x] They choose countries and an age range; nothing else about targeting is
      asked
- [x] They add between one and six ads, each with an image or a video, primary
      text, a headline and a button defaulting to Shop now
- [x] An ad's image can be picked from a product's own media or uploaded
- [x] An ad's destination is a product, all products, the home page or a custom
      path, and always resolves to the Store's storefront
- [x] Every created ad carries the link tags naming the platform's campaign and
      ad ids, written in the same call that creates it
- [x] The campaign is validated against the platform's dry run before anything
      is created, and its complaints — budget minimums, image dimensions,
      rejected copy — appear on the form
- [x] Publish creates it live; Save as paused creates it paused
- [x] A retried create cannot produce two campaigns
- [x] The created campaign, its ads and their platform ids are stored here
      immediately, without waiting for the next sync
- [x] It appears in the grid as Tracked, with its cover taken from its first ad
- [x] A create that fails at the platform leaves nothing half-made here and says
      what the platform objected to
- [x] Creating requires `campaigns.write`, and is impossible without a live
      connection
- [x] An end-to-end spec proves a created campaign carries its tags, and that an
      Order arriving with those ids credits it

## Comments

Done. Backend `tsc`, `nest build`, `npm test` (512 unit specs, 18 of them for
the draft rules and 9 for the adapter's create and dry run) and the new
`campaign-creation.e2e-spec.ts` (18 specs) are green. `eslint` is clean over
everything touched, and the frontend build (`vite build && tsc --noEmit`)
passes. The UI is untested, per the spec's testing floor. Nothing ran against a
live account. The full e2e run has one failure, `inline-edit.e2e-spec.ts`
(`canEditContent`), the same pre-existing one earlier tickets recorded.
`campaign-revenue.e2e-spec.ts` asserted that `POST /campaigns` was a 404. This
ticket makes that route real, so that one line was removed. Archive and delete
are still asserted absent.

**Endpoints**, both `campaigns.write`, in the ad-platform module:

- `POST /api/admin/campaigns` needs an `Idempotency-Key` header (400 without
  one). It answers 201 with `{ campaignId, externalId, tracked, replayed,
  unchecked }`. It answers 422 with `{ message, complaints[] }`, where each
  complaint is `{ adIndex | null, field | null, message }`. It answers 409 when
  Meta is not connected or the same create is in flight, and 503 when the
  platform failed without answering.
- `POST /api/admin/campaigns/creatives` takes a multipart upload (JPEG/PNG up
  to 30 MB, MP4/MOV up to 100 MB) into
  `ad-creatives/{org}/{store}/uploads/`. It answers `{ url, kind }`.

**The vendor's create, as its OpenAPI spec describes it.** The adapter sends
the several-creatives shape of `POST /v1/ads/create`: one campaign, one ad set,
N ads. It uses `goal: conversions` with `promotedObject { pixelId,
customEventType: PURCHASE }`, `budgetLevel: campaign`, and a daily
`budgetAmount` converted by `toDecimalAmount`. `countries`, `ageMin` and
`ageMax` are sent, and placements and bid strategy are omitted. `status` is
ACTIVE or PAUSED. **`tracking.urlTags`**, which the vendor applies to every ad
of the shape, carries the tags, so they are part of the create call itself.
The tags are also part of `CampaignDraft` in the interface, so no caller can
build a draft without them. The same request carries the `Idempotency-Key`.

**Three layers stop a retry making a second campaign:**
- Our `campaigns.creation_key` column (migration 0031, unique per store) answers
  a retry without calling the platform.
- The vendor's own replay of the same key (24 h) answers a retry whose first
  answer was lost before we stored it.
- An in-process guard, plus the vendor's 409, handles two presses in flight.

The e2e covers a lost answer followed by a retry.

**Dry run.** The vendor's `validateOnly` rejects the several-creatives shape
and new video uploads. So the adapter dry-runs each image ad as its own
single-ad campaign, with the same budget, dates, audience, tags and Pixel.
Video ads are returned as `unchecked`, and the form says Meta checks them at
create. A complaint that every checked ad raised is reported once, against the
campaign. Meta's `error_user_msg` is used where present, since it is written
for the person who made the ad. The vendor's `param` places a complaint on a
field, and `creatives[n]` places it on an ad. A refusal of the real create
comes back the same way, as a 422, and nothing is written. Rows are only
written after the platform answers 201.

**Stored straight away.** `CampaignMirrorRepository.recordCreated` upserts the
campaign and its ads on the platform ids, as the sync does. It sets the
creation key, the cover (the first ad's image, or the first image if the first
ad is a video) and each ad's creative (our own product or upload URL, never
the platform's expiring link). Each new ad's tags are then **read back**, up to
six reads, and recorded, so Tracked reflects what the platform holds rather
than what we sent. If a read fails, that ad stays unconfirmed and the next sync
reads it. No sync runs after a create.

Judgement calls:

- **References, not URLs.** The form sends a product media id or an upload
  URL, and the server checks the upload URL is under this store's upload
  prefix. It sends a product id or a destination kind, and the server resolves
  it with ticket 03's `resolveStorefrontUrl`. So no ad can show another
  tenant's image or link off the storefront. A destination product must be
  active: a draft product has no storefront page.
- **Dates are the Store's days.** A start of today means "now" (Meta refuses a
  start in the past). A later start is the Store's midnight, and the end is
  the midnight after the end day, so the end day is spent in full. The util
  has DST-aware tests.
- **Ages run 18–65, not Meta's 13–65.** A shop's ads are for adults. Countries
  are two-letter codes, at least one.
- **Advantage+ audience is left at the vendor's default (off)**, so the
  merchant's age range is a hard limit rather than a suggestion. If "leave the
  rest to the platform" was meant to include it, it is one field in
  `campaignBody`.
- **Ads are named "{campaign} · Ad N"** because the form does not ask for a
  name.
- **Publish asks for confirmation** and states the daily spend. Save as paused
  does not.
- **`GET /stores/:id/storefront` now also returns `currency` and `timezone`.**
  The form needs both, and `GET /stores` requires `settings.write`, which a
  `product_manager` lacks.
- **Uploads go through a server function as base64**, as product media does.
  That is fine for images. A 100 MB video is heavy this way, and a presigned
  direct upload is the better path if videos turn out to be common.

**Still to confirm against a live account:**
- That Meta's budget-minimum and image-size complaints carry a `param`. If
  they do not, a single-image dry run places them on the ad rather than on the
  campaign.
- That `tracking.urlTags` on the several-creatives shape reads back from
  `GET /v1/ads/{adId}/tracking-tags`, as the vendor's docs say. If it does not,
  created campaigns read Not Tracked, which is loud rather than silent: the
  read-back is exactly what would catch it.
