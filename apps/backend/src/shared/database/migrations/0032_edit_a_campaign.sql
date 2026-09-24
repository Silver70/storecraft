CREATE TYPE "public"."campaign_budget_level" AS ENUM('campaign', 'ad_set');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "budget_level" "campaign_budget_level";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "daily_budget" integer;--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "ad_set_external_id" varchar(255);--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "creation_key" varchar(255);--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_store_creation_key_unique" UNIQUE("store_id","creation_key");