import { createFileRoute } from "@tanstack/react-router";
import {
  campaignAdsQueryOptions,
  campaignQueryOptions,
  campaignRulesQueryOptions,
} from "~/features/campaigns/queries";
import { CampaignDetailPage } from "~/features/campaigns/pages/campaign-detail-page";

export const Route = createFileRoute("/admin/campaigns_/$campaignId")({
  loader: async ({ context, params }) => {
    // The rules and ads load alongside the campaign so their cards arrive with
    // the page rather than flashing empty after it.
    const [campaign] = await Promise.all([
      context.queryClient.ensureQueryData(
        campaignQueryOptions(params.campaignId),
      ),
      context.queryClient.ensureQueryData(
        campaignRulesQueryOptions(params.campaignId),
      ),
      context.queryClient.ensureQueryData(
        campaignAdsQueryOptions(params.campaignId),
      ),
    ]);
    return campaign;
  },
  component: CampaignDetailPage,
});
