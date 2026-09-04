import { createFileRoute } from "@tanstack/react-router";
import { campaignsQueryOptions } from "~/features/campaigns/queries";
import { CampaignListPage } from "~/features/campaigns/pages/campaign-list-page";

export const Route = createFileRoute("/admin/campaigns_/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(campaignsQueryOptions("all")),
  component: CampaignListPage,
});
