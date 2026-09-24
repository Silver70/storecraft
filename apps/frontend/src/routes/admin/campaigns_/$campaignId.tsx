import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  campaignPerformanceQueryOptions,
  campaignQueryOptions,
} from "~/features/campaigns/queries";
import { CampaignDetailPage } from "~/features/campaigns/pages/campaign-detail-page";
import { defaultCampaignPeriod } from "~/features/campaigns/utils";

export const Route = createFileRoute("/admin/campaigns_/$campaignId")({
  // The period lives in the URL so a campaign read over its lifetime can be
  // linked to as that. Absent means "the default for this campaign", which is
  // only known once its status is.
  validateSearch: z.object({
    period: z.enum(["7d", "30d", "90d", "lifetime"]).optional(),
  }),
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: async ({ context, params, deps }) => {
    const campaign = await context.queryClient.ensureQueryData(
      campaignQueryOptions(params.campaignId),
    );
    await context.queryClient.ensureQueryData(
      campaignPerformanceQueryOptions(
        params.campaignId,
        deps.period ?? defaultCampaignPeriod(campaign.status),
      ),
    );
    return campaign;
  },
  component: CampaignDetailPage,
});
