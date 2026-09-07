import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { inlineEditQueryOptions } from "~/features/inline-edit/server";
import { StoreEditorPage } from "~/features/inline-edit/store-editor-page";

export const Route = createFileRoute("/admin/store")({
  validateSearch: z.object({
    productSlug: z.string().max(255).optional(),
    categorySlug: z.string().max(255).optional(),
    // Where "Exit editor" goes: the admin page the editor was opened from.
    // Confined to this admin so leaving the editor cannot become an open
    // redirect out of it.
    returnTo: z
      .string()
      .max(255)
      .regex(/^\/admin(\/[A-Za-z0-9\-._~/]*)?$/)
      .optional(),
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(inlineEditQueryOptions()),
  component: StoreEditorPage,
});
