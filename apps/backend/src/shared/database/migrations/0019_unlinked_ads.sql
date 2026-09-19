-- Unlinked Ads: the ads a platform is spending on that nothing here claims.
--
-- This table is what a sync writes *instead of* an Ad. An Ad invented from a
-- platform's tree would carry real cost and have no Ad Tag rule, so it could
-- never earn revenue — it would show spend against zero and read as the worst
-- performer in the account. Holding the ad here keeps the money visible and
-- leaves the one decision only a merchant can make to the merchant.
--
-- `state` is an enum and not a pair of flags because claim and dismiss are a
-- state machine with rules about which transition may follow which, in the
-- convention `orders.status` already sets. Two booleans would permit a row that
-- is both claimed and dismissed.
--
-- The unique constraint on (connection_id, external_ad_id) is what makes a
-- dismissal durable: a sync meets the same ad every run by design, and the
-- conflict clause turns the second meeting into a refresh of its name and
-- creative rather than a second row asking a question already answered.
--
-- The partial unique index on `ads` is the other half of a claim. Reported
-- Figures are keyed on the platform's ad id, so `ads.external_id` is the join
-- that attaches an ad's whole pulled history — backfill included — to the Ad it
-- was claimed onto. Two Ads carrying one platform id would both match those
-- rows and report the same spend twice under two names, so at most one Ad in a
-- Store may claim a given platform ad. Partial, because most Ads have no
-- platform id and every one of them is free to have none.

CREATE TYPE "public"."unlinked_ad_state" AS ENUM('pending', 'claimed', 'dismissed');--> statement-breakpoint
CREATE TABLE "unlinked_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"external_ad_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"creative_url" text,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"state" "unlinked_ad_state" DEFAULT 'pending' NOT NULL,
	"claimed_ad_id" uuid,
	"claimed_at" timestamp,
	"dismissed_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unlinked_ads_connection_ad_unique" UNIQUE("connection_id","external_ad_id")
);
--> statement-breakpoint
ALTER TABLE "unlinked_ads" ADD CONSTRAINT "unlinked_ads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlinked_ads" ADD CONSTRAINT "unlinked_ads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlinked_ads" ADD CONSTRAINT "unlinked_ads_connection_id_ad_platform_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ad_platform_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlinked_ads" ADD CONSTRAINT "unlinked_ads_claimed_ad_id_ads_id_fk" FOREIGN KEY ("claimed_ad_id") REFERENCES "public"."ads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unlinked_ads_org_store_state_idx" ON "unlinked_ads" USING btree ("organization_id","store_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_store_external_id_unique" ON "ads" USING btree ("store_id","external_id") WHERE "ads"."external_id" is not null;