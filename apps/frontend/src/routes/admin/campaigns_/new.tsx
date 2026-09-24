import { createFileRoute } from "@tanstack/react-router";
import {
  adPlatformConnectionsQueryOptions,
  campaignFormContextQueryOptions,
} from "~/features/campaigns/queries";
import { CampaignNewPage } from "~/features/campaigns/pages/campaign-new-page";

export const Route = createFileRoute("/admin/campaigns_/new")({
  // Whether there is a live connection to create on, and the store's currency,
  // timezone and storefront: the two reads the form cannot be drawn without.
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(adPlatformConnectionsQueryOptions()),
      context.queryClient.ensureQueryData(campaignFormContextQueryOptions()),
    ]),
  component: CampaignNewPage,
});
