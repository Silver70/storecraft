import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  organizationQueryOptions,
  storesQueryOptions,
} from "~/features/settings/queries";
import { SettingsPage } from "~/features/settings/pages/settings-page";

export const Route = createFileRoute("/admin/settings")({
  // Addressable so a link can open one panel. Connecting an ad platform used to
  // land here too; it belongs to the campaigns page now, because it is not a
  // preference — without it that page has nothing on it at all.
  validateSearch: z.object({
    section: z
      .enum(["general", "stores", "team", "api-keys", "tax-rates", "audit-log"])
      .optional(),
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(storesQueryOptions()),
      context.queryClient.ensureQueryData(organizationQueryOptions()),
    ]),
  component: SettingsPage,
});
