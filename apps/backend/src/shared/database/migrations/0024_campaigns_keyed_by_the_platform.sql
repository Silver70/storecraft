DROP TABLE "campaigns" CASCADE;--> statement-breakpoint
DROP TABLE "ads" CASCADE;--> statement-breakpoint
DROP TABLE "campaign_matching_rules" CASCADE;--> statement-breakpoint
DROP TYPE "public"."campaign_platform";--> statement-breakpoint
DROP TYPE "public"."campaign_status";--> statement-breakpoint
DROP TYPE "public"."ad_platform_state";--> statement-breakpoint
DROP TYPE "public"."campaign_rule_field";--> statement-breakpoint
DROP TYPE "public"."campaign_rule_operator";--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('active', 'paused', 'in_review', 'needs_attention', 'ended');--> statement-breakpoint
CREATE TYPE "public"."ad_format" AS ENUM('image', 'video', 'carousel');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "campaign_status" NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"cover_url" text,
	"has_link_tags" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_store_external_id_unique" UNIQUE("store_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"format" "ad_format",
	"status" "campaign_status" NOT NULL,
	"creative_url" text,
	"has_link_tags" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ads_store_external_id_unique" UNIQUE("store_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "ad_daily_figures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"ad_id" uuid NOT NULL,
	"day" date NOT NULL,
	"spend" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ad_daily_figures_ad_day_unique" UNIQUE("ad_id","day")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_daily_figures" ADD CONSTRAINT "ad_daily_figures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_daily_figures" ADD CONSTRAINT "ad_daily_figures_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_daily_figures" ADD CONSTRAINT "ad_daily_figures_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_org_store_status_idx" ON "campaigns" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE INDEX "ads_org_store_idx" ON "ads" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE INDEX "ads_campaign_idx" ON "ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ad_daily_figures_org_store_day_idx" ON "ad_daily_figures" USING btree ("organization_id","store_id","day");