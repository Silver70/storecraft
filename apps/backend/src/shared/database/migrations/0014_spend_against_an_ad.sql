-- Spend can now name an Ad, or name no Ad and belong to the Campaign as a whole.
--
-- `NULLS NOT DISTINCT` is the load-bearing word. Postgres treats nulls as
-- distinct by default, so a plain UNIQUE (campaign_id, ad_id, day) would admit
-- two Campaign-level rows for the same day, the upsert would find nothing to
-- conflict with, and a double-submit would double that day's cost silently and
-- forever. With it: at most one Campaign-level row per day, and at most one row
-- per Ad per day — the guarantee the constraint it replaces was there to give.
--
-- The column is added nullable and nothing backfills it. Existing rows keep no
-- Ad, because they genuinely had none: a synthetic "default Ad" would sit in
-- the card grid forever claiming to be a creative that never ran.
ALTER TABLE "campaign_spend" DROP CONSTRAINT "campaign_spend_campaign_day_unique";--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD COLUMN "ad_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_spend_ad_day_idx" ON "campaign_spend" USING btree ("ad_id","day");--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_campaign_ad_day_unique" UNIQUE NULLS NOT DISTINCT("campaign_id","ad_id","day");