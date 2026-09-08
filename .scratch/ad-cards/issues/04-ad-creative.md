# 04: Ad creative

**What to build:** A merchant recognises an Ad by its picture instead of
decoding its slug. They upload the creative image to an Ad and see it in the
admin. An Ad with no image still looks deliberate.

This is what makes the card grid in ticket 05 worth building. It is independent
of attribution and can be built in parallel with 02 and 03.

**Blocked by:** 01 (Ad as a managed object).

**Status:** ready-for-agent

- [ ] A merchant uploads an image to an Ad from the admin and sees it against
      that Ad
- [ ] The upload reuses the storage service and the multipart upload shape the
      admin already uses for product media, rather than introducing a second way
      to store an image. Same validation posture, same tenant scoping
- [ ] A merchant replaces an Ad's creative, and removes it
- [ ] The creative is an optional reference on the Ad. A later platform sync will
      fill the same field an upload fills, so nothing here needs revisiting when
      that lands
- [ ] **The empty state is designed, not a broken image.** It will be the
      majority state for months, and permanently for Campaigns on `email`,
      `sms`, `affiliate`, `influencer` and `other`, which no sync will ever
      supply an image for
- [ ] Uploading to an Ad belonging to another Organization is refused
- [ ] Covered end to end alongside the Ad management coverage from 01
