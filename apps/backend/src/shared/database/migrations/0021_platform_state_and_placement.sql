-- Platform State and Placement: what the ad platform says about an Ad, beside
-- what we say, and never instead of it.
--
-- `platform_state` is the platform's own view — approved, rejected, in review,
-- delivering, paused. `ads.status` is the merchant's. **They are two
-- independent facts and neither is allowed to overwrite the other.** An Ad that
-- is active here and rejected there is the card that saves a merchant a week of
-- wondering why a campaign stopped producing, and that card only exists if the
-- sync cannot touch `status` and the merchant's archive cannot touch this. That
-- is why this is a second column and not a widened `campaign_status` enum: one
-- column would force the sync to overwrite, and an ad paused at the platform
-- would vanish out of the merchant's active list taking its history with it.
--
-- `placement` is a recognition label and nothing more — "Instagram Stories",
-- the way the merchant already reads it on the platform's own screen. It is
-- deliberately free text rather than an enum and deliberately has no index: one
-- ad runs in several placements at once, so anything reported by, filtered by
-- or grouped by this column would be a many-to-many pretending to be a
-- dimension, and the first report built on it would double-count spend.
--
-- Both are nullable and both are written only by the sync. An Ad that was never
-- synced has neither, which is the ordinary state for every Ad on an email,
-- SMS, affiliate or influencer campaign and for every Ad created before a
-- platform was ever connected. Nothing backfills them, because nothing here
-- knows what a platform would have said.
--
-- `platform_reported_at` dates them. When a platform stops reporting an ad the
-- two values are **preserved, not cleared**, and this column is what makes that
-- honest: an ad drops out of a tree for reasons that are not facts about the ad
-- — it fell outside the window asked for, a quota refusal truncated the answer,
-- the merchant disconnected the account — so clearing would flicker the card
-- against the sync's luck rather than against anything at the platform. The
-- last thing the platform said is kept, with the date it said it, so a stale
-- "rejected" reads as stale instead of as current. The one thing that does
-- clear all three is unlinking the Ad from the platform ad, because an Ad that
-- claims no platform ad has no platform state to display.

CREATE TYPE "public"."ad_platform_state" AS ENUM('approved', 'rejected', 'in_review', 'delivering', 'paused');--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "platform_state" "ad_platform_state";--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "placement" varchar(120);--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "platform_reported_at" timestamp;
