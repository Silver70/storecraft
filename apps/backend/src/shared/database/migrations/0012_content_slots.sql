CREATE TYPE "public"."content_slot_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."content_slot_type" AS ENUM('heading', 'text');--> statement-breakpoint
CREATE TABLE "content_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"key" varchar(64) NOT NULL,
	"type" "content_slot_type" NOT NULL,
	"value" text,
	"draft_value" text,
	"status" "content_slot_status" DEFAULT 'draft' NOT NULL,
	"last_published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_slots_store_key_unique" UNIQUE("store_id","key")
);
--> statement-breakpoint
ALTER TABLE "content_slots" ADD CONSTRAINT "content_slots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_slots" ADD CONSTRAINT "content_slots_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_slots_org_store_idx" ON "content_slots" USING btree ("organization_id","store_id");