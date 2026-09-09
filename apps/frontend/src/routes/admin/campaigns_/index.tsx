import { createFileRoute } from "@tanstack/react-router";
import {
  attributedRevenueQueryOptions,
  campaignsQueryOptions,
} from "~/features/campaigns/queries";
import { CampaignsPage } from "~/features/campaigns/pages/campaigns-page";

export const Route = createFileRoute("/admin/campaigns_/")({
  // The campaigns and the period's figures load together because the page is
  // one thing: cards that arrived without their numbers, or numbers without the
  // campaigns they belong to, would be the split page this merge removed.
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(campaignsQueryOptions("all")),
      context.queryClient.ensureQueryData(
        attributedRevenueQueryOptions("30d", "last"),
      ),
    ]),
  component: CampaignsPage,
});
