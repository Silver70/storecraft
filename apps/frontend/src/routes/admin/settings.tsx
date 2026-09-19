import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  organizationQueryOptions,
  storesQueryOptions,
} from "~/features/settings/queries";
import { SettingsPage } from "~/features/settings/pages/settings-page";

export const Route = createFileRoute("/admin/settings")({
  // An ad platform returns the merchant here when they finish approving, so the
  // page has to be addressable: which panel to open, which platform the trip
  // was for, and how it ended. The backend redirect is the only thing that sets
  // the last two, and they are validated here like any other untrusted input.
  validateSearch: z.object({
    section: z
      .enum([
        "general",
        "stores",
        "team",
        "api-keys",
        "ad-platforms",
        "tax-rates",
        "audit-log",
      ])
      .optional(),
    ad_platform: z
      .enum(["meta", "google", "tiktok", "linkedin", "pinterest", "x"])
      .optional(),
    ad_platform_result: z
      .enum(["connected", "not_approved", "failed"])
      .optional(),
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(storesQueryOptions()),
      context.queryClient.ensureQueryData(organizationQueryOptions()),
    ]),
  component: SettingsPage,
});
