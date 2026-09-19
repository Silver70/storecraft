-- A Store can now be connected to an ad platform, so that the figures the
-- platform already holds stop being typed in by hand.
--
-- Two tables and not one, because they have two lifetimes. A connection is
-- what the merchant sees and what a Reported Figure will later point at; it is
-- disconnected, never deleted, so revoking access cannot rewrite a past report.
-- A credential is the secret behind it, held one per Store — the provider's
-- posting surface accepts any account id its holder can name, so the narrowest
-- key it will issue is the one we ask for — and destroyed the moment the last
-- connection using it goes.
--
-- `sealed_secret` is ciphertext. Nothing selects it into a response type and
-- nothing logs it; it is opened only at the call that is about to hand the
-- secret back to the provider.

CREATE TYPE "public"."ad_platform_connection_status" AS ENUM('connected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."ad_platform" AS ENUM('meta', 'google', 'tiktok', 'linkedin', 'pinterest', 'x');--> statement-breakpoint
CREATE TABLE "ad_platform_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"provider_ref" varchar(255) NOT NULL,
	"sealed_secret" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ad_platform_credentials_store_id_unique" UNIQUE("store_id")
);
--> statement-breakpoint
CREATE TABLE "ad_platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"external_account_id" varchar(255) NOT NULL,
	"account_name" varchar(255),
	"account_currency" varchar(3),
	"status" "ad_platform_connection_status" DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ad_platform_connections_store_platform_unique" UNIQUE("store_id","platform")
);
--> statement-breakpoint
ALTER TABLE "ad_platform_credentials" ADD CONSTRAINT "ad_platform_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_platform_credentials" ADD CONSTRAINT "ad_platform_credentials_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD CONSTRAINT "ad_platform_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_platform_connections" ADD CONSTRAINT "ad_platform_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_platform_connections_org_store_status_idx" ON "ad_platform_connections" USING btree ("organization_id","store_id","status");