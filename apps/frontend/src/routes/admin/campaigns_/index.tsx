import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  adPlatformConnectionsQueryOptions,
  attributedRevenueQueryOptions,
} from "~/features/campaigns/queries";
import { CampaignsPage } from "~/features/campaigns/pages/campaigns-page";

export const Route = createFileRoute("/admin/campaigns_/")({
  // Meta returns the merchant here when they finish approving, so the page has
  // to be addressable: which platform the trip was for, and how it ended. The
  // backend redirect is the only thing that sets either, and they are validated
  // here like any other untrusted input.
  validateSearch: z.object({
    ad_platform: z.enum(["meta"]).optional(),
    ad_platform_result: z
      .enum(["connected", "choose_account", "not_approved", "failed"])
      .optional(),
  }),
  // The connection decides which of three pages this is, and the report carries
  // every campaign with its figures, so the whole page is two reads.
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(adPlatformConnectionsQueryOptions()),
      context.queryClient.ensureQueryData(attributedRevenueQueryOptions("30d")),
    ]),
  component: CampaignsPage,
});
