import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Performance moved onto the thing it describes.
 *
 * A redirect rather than a removal: this URL is linked from the dashboard, from
 * anything a merchant bookmarked, and from the report link in their own notes.
 * A 404 here would read as the feature having been taken away, when it has only
 * moved one level up.
 */
export const Route = createFileRoute("/admin/campaigns_/revenue")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/campaigns", replace: true });
  },
});
