import { createFileRoute } from "@tanstack/react-router";
import { CampaignNewPage } from "~/features/campaigns/pages/campaign-new-page";

export const Route = createFileRoute("/admin/campaigns_/new")({
  component: CampaignNewPage,
});
