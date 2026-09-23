ALTER TABLE "stores" ADD COLUMN "storefront_url" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "product_path_pattern" varchar(255) DEFAULT '/products/{slug}' NOT NULL;