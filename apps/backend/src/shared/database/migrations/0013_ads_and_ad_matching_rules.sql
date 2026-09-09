ALTER TYPE "public"."campaign_rule_field" ADD VALUE 'utm_content';--> statement-breakpoint
CREATE TABLE "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"tag" varchar(255) NOT NULL,
	"external_id" varchar(255),
	"starts_at" timestamp,
	"ends_at" timestamp,
	"status" "campaign_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ads_campaign_tag_unique" UNIQUE("campaign_id","tag")
);
--> statement-breakpoint
ALTER TABLE "campaign_matching_rules" ADD COLUMN "ad_id" uuid;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ads_org_store_status_idx" ON "ads" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE INDEX "ads_campaign_status_idx" ON "ads" USING btree ("campaign_id","status");--> statement-breakpoint
ALTER TABLE "campaign_matching_rules" ADD CONSTRAINT "campaign_matching_rules_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_matching_rules_ad_idx" ON "campaign_matching_rules" USING btree ("ad_id");