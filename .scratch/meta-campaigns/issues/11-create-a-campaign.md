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

**Status:** ready-for-agent

- [ ] A merchant creates a campaign with a name, a daily budget in the Store's
      currency, a start date and an optional end date
- [ ] They choose countries and an age range; nothing else about targeting is
      asked
- [ ] They add between one and six ads, each with an image or a video, primary
      text, a headline and a button defaulting to Shop now
- [ ] An ad's image can be picked from a product's own media or uploaded
- [ ] An ad's destination is a product, all products, the home page or a custom
      path, and always resolves to the Store's storefront
- [ ] Every created ad carries the link tags naming the platform's campaign and
      ad ids, written in the same call that creates it
- [ ] The campaign is validated against the platform's dry run before anything
      is created, and its complaints — budget minimums, image dimensions,
      rejected copy — appear on the form
- [ ] Publish creates it live; Save as paused creates it paused
- [ ] A retried create cannot produce two campaigns
- [ ] The created campaign, its ads and their platform ids are stored here
      immediately, without waiting for the next sync
- [ ] It appears in the grid as Tracked, with its cover taken from its first ad
- [ ] A create that fails at the platform leaves nothing half-made here and says
      what the platform objected to
- [ ] Creating requires `campaigns.write`, and is impossible without a live
      connection
- [ ] An end-to-end spec proves a created campaign carries its tags, and that an
      Order arriving with those ids credits it
