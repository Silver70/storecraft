import { createFileRoute, notFound } from "@tanstack/react-router";
import { productQueryOptions } from "~/features/catalog/queries";
import { ProductDetailPage } from "~/features/catalog/pages/product-detail-page";
import { seo } from "~/utils/seo";

export const Route = createFileRoute("/products/$slug")({
  loader: async ({ context, params }) => {
    const product = await context.queryClient.ensureQueryData(
      productQueryOptions(params.slug),
    );
    if (!product) throw notFound();
    return { product };
  },
  // The merchant's SEO copy, falling back to the copy shoppers already read.
  // Without this the fields exist in the admin and reach nothing.
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: seo({
            title: loaderData.product.seoTitle || loaderData.product.name,
            description:
              loaderData.product.seoDescription ||
              loaderData.product.description ||
              undefined,
          }),
        }
      : {},
  component: ProductDetailPage,
});
