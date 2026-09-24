CREATE TYPE "public"."ad_review_status" AS ENUM('in_review', 'approved', 'rejected', 'with_issues');--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "review_status" "ad_review_status";