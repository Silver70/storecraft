-- Spend provenance and pinning: a row now says who wrote it, and whether a
-- sync may overwrite it.
--
-- A synced figure and a merchant's own entry can both describe one day for one
-- Ad. `source` records which this is, so a merchant can tell what they typed
-- from what was pulled without a join. `pinned` decides who wins: a sync
-- overwrites an unpinned row by default, because the alternative is a merchant
-- maintaining two sets of books — and it is refused by a pinned one, because a
-- day reconciled against an invoice being silently reverted an hour later is
-- the failure this whole design exists to prevent. A sync that is refused
-- records that it declined rather than treating it as an error.
--
-- Both columns are added with defaults and nothing backfills them. Every row
-- that existed before this migration genuinely was typed by a merchant and was
-- never pinned, because there was no sync able to write one and nothing to be
-- protected from.
--
-- The day-uniqueness guarantee is untouched. `campaign_spend_campaign_ad_day_unique`
-- (UNIQUE NULLS NOT DISTINCT on campaign_id, ad_id, day) stays exactly as
-- `0014_spend_against_an_ad` left it, and it is still what makes a write a
-- correction rather than an addition — now for a sync's write as well as a
-- merchant's. Neither new column is part of the key: two rows for one day, one
-- synced and one manual, would be the doubling that constraint exists to
-- prevent.

CREATE TYPE "public"."spend_source" AS ENUM('manual', 'synced');--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD COLUMN "source" "spend_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_spend" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;
