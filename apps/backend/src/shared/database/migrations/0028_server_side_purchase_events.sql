CREATE TYPE "public"."purchase_dispatch_state" AS ENUM('pending', 'sent', 'withheld', 'expired');--> statement-breakpoint
CREATE TABLE "purchase_event_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"state" "purchase_dispatch_state" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" varchar(500),
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_event_dispatches_order_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_event_dispatches" ADD CONSTRAINT "purchase_event_dispatches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_event_dispatches" ADD CONSTRAINT "purchase_event_dispatches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_event_dispatches" ADD CONSTRAINT "purchase_event_dispatches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_event_dispatches_state_attempt_idx" ON "purchase_event_dispatches" USING btree ("state","last_attempt_at");