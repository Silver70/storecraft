import { createFileRoute } from "@tanstack/react-router";
import { attributedRevenueQueryOptions } from "~/features/campaigns/queries";
import { CampaignsPage } from "~/features/campaigns/pages/campaigns-page";

export const Route = createFileRoute("/admin/campaigns_/")({
  // The report carries every campaign with its figures, so the page is one read.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(attributedRevenueQueryOptions("30d")),
  component: CampaignsPage,
});
