ALTER TYPE "public"."ad_platform_connection_status" ADD VALUE 'awaiting_account' BEFORE 'connected';--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ALTER COLUMN "external_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_platform_credentials" ADD COLUMN "provider_key_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "provider_account_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD COLUMN "pixel_id" varchar(64);