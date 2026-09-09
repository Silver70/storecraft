# 04: Ad creative

**What to build:** A merchant recognises an Ad by its picture instead of
decoding its slug. They upload the creative image to an Ad and see it in the
admin. An Ad with no image still looks deliberate.

This is what makes the card grid in ticket 05 worth building. It is independent
of attribution and can be built in parallel with 02 and 03.

**Blocked by:** 01 (Ad as a managed object).

**Status:** resolved

- [x] A merchant uploads an image to an Ad from the admin and sees it against
      that Ad
- [x] The upload reuses the storage service and the multipart upload shape the
      admin already uses for product media, rather than introducing a second way
      to store an image. Same validation posture, same tenant scoping
- [x] A merchant replaces an Ad's creative, and removes it
- [x] The creative is an optional reference on the Ad. A later platform sync will
      fill the same field an upload fills, so nothing here needs revisiting when
      that lands
- [x] **The empty state is designed, not a broken image.** It will be the
      majority state for months, and permanently for Campaigns on `email`,
      `sms`, `affiliate`, `influencer` and `other`, which no sync will ever
      supply an image for
- [x] Uploading to an Ad belonging to another Organization is refused
- [x] Covered end to end alongside the Ad management coverage from 01

## Comments

Implemented 2026-09-09.

**One nullable column, and a sync can fill it.** `ads.creative_url` is text, and
that is the whole model — no media table, no storage key beside it, no join. The
reason is the sync of a later stage: it will write a URL it hosts itself, so a
column holding a storage key would have needed a second column, or a rule about
which one wins. Nothing that reads a creative can tell whether an upload or a
sync wrote it, which is exactly the property that makes this not need revisiting.
The object behind a replaced creative is left in the bucket, as replacing product
media leaves its predecessor: the column is the only thing anything reads, and a
failed delete would turn a successful upload into an error a merchant cannot act
on.

**The upload is the product-media pattern, with the order of two steps
reversed.** Same `R2StorageService`, same `FileInterceptor('file')` multipart
shape, same `ParseFilePipe` with the 10MB ceiling and the image-only type
validator. The one difference is deliberate: `AdminProductController` uploads
the bytes and then asks the service whether the product exists, so a request
naming another tenant's id is refused only after its bytes are in the bucket.
`AdService.setCreative` resolves the Ad first, through the same `get` every other
Ad route goes through, and stores nothing if that 404s. The e2e case asserts both
halves — the 404 and that `storage.stored` did not grow.

**Object storage gained a fake, for the reason Stripe has one.** `.env.test`
said "no test touches object storage"; now `FakeStorageService` is overridden
into the test app beside `FakePaymentProvider`, and it records what it was
handed. That is what lets a test assert the negative — that a refused upload
wrote nothing — rather than only that it returned 404. `AdminClient.attach`
sends the multipart request, since one supertest request cannot both `.send()`
JSON and `.attach()` a file.

**The e2e suite now runs with `--experimental-vm-modules`.** Nest 11's
`FileTypeValidator` verifies magic numbers by dynamically importing the ESM-only
`file-type` package. Under ts-jest that import fails, the validator silently
returns false, and every upload came back 400 — production was fine, the suite
was not. The flag is what Nest's own warning recommends and is now in the
`test:e2e` script. Worth knowing: product-media upload has never had e2e
coverage, so this was the first time the validator ran under Jest at all.

**On screen, the empty tile is the designed thing.** `components/ad-creative.tsx`
renders a 44px tile on every ad row: the creative when there is one, otherwise a
dashed placeholder with an image glyph that reads as an invitation rather than as
a picture that failed to load. It is the majority state and will stay so — click
to upload or replace, corner button to remove. An image whose URL 404s falls back
to the same placeholder, so the one thing that cannot appear is a broken image.
The card also now says in one line that a creative is optional.

**Not done here.** The card grid is issue 05; this puts the creative on the ad
list inside the campaign detail page, which is where ads are managed today. The
attributed-revenue report does not carry `creativeUrl` on its per-ad lines — 05
adds that when it builds the cards, since it reads ads and figures together.

**Unrelated, pre-existing:** `inline-edit.e2e-spec.ts` fails on a clean tree —
it expects the inline-edit config without the `canEditContent` field the content
feature added. Left alone.
