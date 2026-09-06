import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { inlineEditQueryOptions } from "~/features/inline-edit/server";
import { StoreEditorPage } from "~/features/inline-edit/store-editor-page";

export const Route = createFileRoute("/admin/store")({
  validateSearch: z.object({ productSlug: z.string().max(255).optional() }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(inlineEditQueryOptions()),
  component: StoreEditorPage,
});
