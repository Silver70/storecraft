import { createFileRoute } from "@tanstack/react-router";
import { homeSections } from "~/config/home-sections";
import { contentSlotsQueryOptions } from "~/features/content/queries";
import {
  categoriesQueryOptions,
  productsQueryOptions,
} from "~/features/catalog/queries";
import { flattenCategories } from "~/features/catalog/utils";
import { HomePage } from "~/features/catalog/pages/home-page";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    // The hero's copy is above the fold, so it is fetched with the page rather
    // than after it.
    const slots = context.queryClient.ensureQueryData(
      contentSlotsQueryOptions(),
    );
    const categories = await context.queryClient.ensureQueryData(
      categoriesQueryOptions(),
    );
    const flat = flattenCategories(categories);
    await slots;
    await Promise.all(
      homeSections.map((section) => {
        const category = flat.find((c) => c.slug === section.categorySlug);
        if (!category) return undefined;
        return context.queryClient.ensureQueryData(
          productsQueryOptions({
            filter: { categoryId: category.id },
            first: section.limit,
          }),
        );
      }),
    );
  },
  component: HomePage,
});
