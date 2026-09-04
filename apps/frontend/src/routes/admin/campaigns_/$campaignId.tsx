import { createFileRoute } from "@tanstack/react-router";
import {
  campaignQueryOptions,
  campaignRulesQueryOptions,
} from "~/features/campaigns/queries";
import { CampaignDetailPage } from "~/features/campaigns/pages/campaign-detail-page";

export const Route = createFileRoute("/admin/campaigns_/$campaignId")({
  loader: async ({ context, params }) => {
    // The rules load alongside the campaign so the matching card arrives with
    // the page rather than flashing empty after it.
    const [campaign] = await Promise.all([
      context.queryClient.ensureQueryData(
        campaignQueryOptions(params.campaignId),
      ),
      context.queryClient.ensureQueryData(
        campaignRulesQueryOptions(params.campaignId),
      ),
    ]);
    return campaign;
  },
  component: CampaignDetailPage,
});
