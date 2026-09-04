import { createFileRoute } from "@tanstack/react-router";
import { campaignQueryOptions } from "~/features/campaigns/queries";
import { CampaignDetailPage } from "~/features/campaigns/pages/campaign-detail-page";

export const Route = createFileRoute("/admin/campaigns_/$campaignId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      campaignQueryOptions(params.campaignId),
    ),
  component: CampaignDetailPage,
});
