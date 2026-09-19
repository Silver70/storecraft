-- The platform's own attribution window, stored beside the figures it
-- qualifies.
--
-- Our Lookback Window is already shown against every ROAS on the page, because
-- it is the reason our number and the platform's disagree. Showing a Reported
-- Figure without the window it was measured over asks a merchant to read that
-- disagreement with only half of the explanation, and the gap is routinely a
-- factor of two — large enough to look like a tracking failure when it is a
-- measurement difference.
--
-- Denormalized onto every row for the same reason `currency` and `platform`
-- already are: this is the caveat on `conversions`, `reported_revenue` and
-- `reported_roas_bp` in the row it sits in, and a caveat that needs a join to
-- read is one a future report will render without.
--
-- Nullable, independently, and null is an ordinary answer rather than a gap to
-- be filled: a platform that states no window has not stated a window of zero,
-- and plenty state a click window and no view window. Nothing infers one — a
-- guessed number displayed beside our own Lookback Window would read as
-- something the platform agreed to.
--
-- Nothing backfills the rows already pulled. What window those figures were
-- measured over is not knowable now, and writing today's answer onto them would
-- date a claim the platform never made.

ALTER TABLE "ad_reported_figures" ADD COLUMN "attribution_click_days" integer;--> statement-breakpoint
ALTER TABLE "ad_reported_figures" ADD COLUMN "attribution_view_days" integer;
