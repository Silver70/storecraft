CREATE TABLE "campaign_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"day" date NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"note" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_spend_campaign_day_unique" UNIQUE("campaign_id","day")
);
--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD CONSTRAINT "campaign_spend_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_spend_org_store_day_idx" ON "campaign_spend" USING btree ("organization_id","store_id","day");--> statement-breakpoint
CREATE INDEX "campaign_spend_campaign_day_idx" ON "campaign_spend" USING btree ("campaign_id","day");