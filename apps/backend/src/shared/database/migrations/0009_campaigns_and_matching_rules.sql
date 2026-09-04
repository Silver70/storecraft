CREATE TYPE "public"."campaign_platform" AS ENUM('meta', 'google', 'tiktok', 'instagram', 'youtube', 'x', 'linkedin', 'pinterest', 'email', 'sms', 'affiliate', 'influencer', 'other');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."campaign_rule_field" AS ENUM('utm_campaign', 'utm_source', 'utm_medium', 'referrer_host');--> statement-breakpoint
CREATE TYPE "public"."campaign_rule_operator" AS ENUM('equals', 'starts_with');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"tag" varchar(255) NOT NULL,
	"platform" "campaign_platform" NOT NULL,
	"external_id" varchar(255),
	"status" "campaign_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_store_tag_unique" UNIQUE("store_id","tag")
);
--> statement-breakpoint
CREATE TABLE "campaign_matching_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"field" "campaign_rule_field" NOT NULL,
	"operator" "campaign_rule_operator" NOT NULL,
	"value" varchar(255) NOT NULL,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_matching_rules_unique" UNIQUE("campaign_id","field","operator","value")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_matching_rules" ADD CONSTRAINT "campaign_matching_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_matching_rules" ADD CONSTRAINT "campaign_matching_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_matching_rules" ADD CONSTRAINT "campaign_matching_rules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_org_store_status_idx" ON "campaigns" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE INDEX "campaign_matching_rules_org_store_idx" ON "campaign_matching_rules" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE INDEX "campaign_matching_rules_campaign_idx" ON "campaign_matching_rules" USING btree ("campaign_id");