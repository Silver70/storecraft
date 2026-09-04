CREATE TYPE "public"."attribution_source" AS ENUM('none', 'declared', 'correlated');--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "attribution_source" "attribution_source" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "visitor_id" varchar(128);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "session_id" varchar(128);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_utm_source" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_utm_medium" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_utm_campaign" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_utm_content" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_referrer" varchar(1024);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_landing_path" varchar(1024);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "first_touch_at" timestamp;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_utm_source" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_utm_medium" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_utm_campaign" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_utm_content" varchar(255);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_referrer" varchar(1024);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_landing_path" varchar(1024);--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_touch_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "attribution_source" "attribution_source" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "visitor_id" varchar(128);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "session_id" varchar(128);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_utm_source" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_utm_medium" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_utm_campaign" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_utm_content" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_referrer" varchar(1024);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_landing_path" varchar(1024);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "first_touch_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_utm_source" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_utm_medium" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_utm_campaign" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_utm_content" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_referrer" varchar(1024);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_landing_path" varchar(1024);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_touch_at" timestamp;