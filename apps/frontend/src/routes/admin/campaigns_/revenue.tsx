import { createFileRoute } from "@tanstack/react-router";
import { attributedRevenueQueryOptions } from "~/features/campaigns/queries";
import { CampaignRevenuePage } from "~/features/campaigns/pages/campaign-revenue-page";

export const Route = createFileRoute("/admin/campaigns_/revenue")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      attributedRevenueQueryOptions("30d", "last"),
    ),
  component: CampaignRevenuePage,
});
