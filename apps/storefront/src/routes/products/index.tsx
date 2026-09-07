import { createFileRoute } from "@tanstack/react-router";
import {
  categoriesQueryOptions,
  productsQueryOptions,
} from "~/features/catalog/queries";
import { findCategoryBySlug } from "~/features/catalog/utils";
import { contentSlotsQueryOptions } from "~/features/content/queries";
import { ProductListPage } from "~/features/catalog/pages/product-list-page";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>): { category?: string } => ({
    category: typeof search.category === "string" ? search.category : undefined,
  }),
  loaderDeps: ({ search }) => ({ category: search.category }),
  loader: async ({ context, deps }) => {
    // The banner sits above the grid, so it is fetched with the page rather
    // than after it.
    const slots = context.queryClient.ensureQueryData(
      contentSlotsQueryOptions(),
    );
    const categories = await context.queryClient.ensureQueryData(
      categoriesQueryOptions(),
    );
    await slots;
    const category = deps.category
      ? findCategoryBySlug(categories, deps.category)
      : undefined;
    await context.queryClient.ensureQueryData(
      productsQueryOptions({
        filter: category ? { categoryId: category.id } : undefined,
        first: 24,
      }),
    );
  },
  component: ProductListPage,
});
