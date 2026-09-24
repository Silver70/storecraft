ALTER TABLE "campaigns" ADD COLUMN "creation_key" varchar(255);--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_store_creation_key_unique" UNIQUE("store_id","creation_key");