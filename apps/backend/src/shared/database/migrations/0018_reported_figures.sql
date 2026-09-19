-- The ad platform's own figures, and the sync state that produced them.
--
-- `ad_reported_figures` is the platform's book; `campaign_spend` remains the
-- merchant's, and nothing here is ever written into it (ADR-0005). The two are
-- displayed side by side and allowed to disagree, which they routinely will.
--
-- Keyed by the *platform's* ad id and not by one of our Ads: a figure arrives
-- before anything in the Store claims the ad it describes, and keying it this
-- way is what lets a later claim pick up the history already pulled, backfill
-- included, instead of re-attributing rows in a second pass.
--
-- The unique constraint is the idempotency of the whole feature. A sync
-- re-pulls recent days on purpose, because platforms restate figures after the
-- fact; without one row per ad per day per connection, a merchant's reported
-- spend would grow every night and never throw.
--
-- The columns added to `ad_platform_connections` are what makes a stale figure
-- legibly stale: when a sync last succeeded, when it last tried, why it failed
-- in words a merchant can read, and when it may try again. A failure is shown
-- on the page, never thrown into a read.

CREATE TABLE "ad_reported_figures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"external_ad_id" varchar(255) NOT NULL,
	"day" date NOT NULL,
	"spend" integer NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"reported_revenue" integer DEFAULT 0 NOT NULL,
	"reported_roas_bp" integer,
	"currency" varchar(3) NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ad_reported_figures_connection_ad_day_unique" UNIQUE("connection_id","external_ad_id","day")
);
--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "last_sync_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "last_sync_error" varchar(500);--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "sync_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "sync_paused_until" timestamp;--> statement-breakpoint
ALTER TABLE "ad_reported_figures" ADD CONSTRAINT "ad_reported_figures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_reported_figures" ADD CONSTRAINT "ad_reported_figures_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_reported_figures" ADD CONSTRAINT "ad_reported_figures_connection_id_ad_platform_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ad_platform_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_reported_figures_org_store_day_idx" ON "ad_reported_figures" USING btree ("organization_id","store_id","day");--> statement-breakpoint
CREATE INDEX "ad_reported_figures_store_external_ad_idx" ON "ad_reported_figures" USING btree ("store_id","external_ad_id");