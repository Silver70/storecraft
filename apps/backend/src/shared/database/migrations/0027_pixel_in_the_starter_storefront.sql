CREATE TYPE "public"."measurement_consent" AS ENUM('granted', 'denied');--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "requires_measurement_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "meta_browser_id" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "meta_click_id" varchar(512);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "measurement_consent" "measurement_consent";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "meta_browser_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "meta_click_id" varchar(512);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "measurement_consent" "measurement_consent";