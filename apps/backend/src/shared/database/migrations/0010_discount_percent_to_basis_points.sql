-- Percentage discounts and coupons were written by the admin UI as whole
-- percent (20) while the pricing engine reads basis points via
-- applyPercentage(cents, bps), so a "20% off" coupon took 0.2% off at
-- storefront checkout. The admin UI now sends basis points; this backfills the
-- rows written before it did.
--
-- The `value <= 100` guard keeps the update idempotent and leaves alone any row
-- already written in basis points through the REST API, whose documented unit
-- was always basis points. Values above 100 cannot be whole percent.
UPDATE "discounts" SET "value" = "value" * 100 WHERE "type" = 'percentage' AND "value" <= 100;--> statement-breakpoint
UPDATE "coupons" SET "value" = "value" * 100 WHERE "type" = 'percentage' AND "value" <= 100;
