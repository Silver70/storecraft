import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { storeConfig } from "~/config/store.config";
import { homeSections, type HomeSection } from "~/config/home-sections";
import { ContentSlot } from "~/features/content/content-slot";
import { Button } from "~/components/ui/button";
import { SectionHeading } from "~/components/layout/section-heading";
import { categoriesQueryOptions, productsQueryOptions } from "../queries";
import { flattenCategories } from "../utils";
import { ProductGrid } from "../components/product-grid";

export function HomePage() {
  const { data: categories } = useSuspenseQuery(categoriesQueryOptions());
  const flat = flattenCategories(categories);

  return (
    <div>
      <Hero />
      <div className="mx-auto max-w-6xl space-y-16 px-4 py-16">
        {homeSections.map((section) => (
          <HomeSectionRow
            key={section.title}
            section={section}
            categoryId={flat.find((c) => c.slug === section.categorySlug)?.id}
          />
        ))}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-24 text-center">
        {/* The headline above the fold is a Content Slot, not a config value:
            seasonal copy on the most valuable text on the Store is a thing the
            merchant changes in the editor, not a deploy. Until they publish
            one, the hero simply has no headline. */}
        <ContentSlot
          slotKey="homepage.hero"
          as="h1"
          className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl"
        />
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          {storeConfig.description}
        </p>
        <div className="mt-8">
          <Button size="lg" asChild>
            <Link to="/products">Shop all</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function HomeSectionRow({
  section,
  categoryId,
}: {
  section: HomeSection;
  categoryId?: string;
}) {
  // Below-the-fold section — `useQuery` with a `?? []` fallback (the loader has
  // already prefetched it for the configured categories).
  const { data } = useQuery({
    ...productsQueryOptions({
      filter: categoryId ? { categoryId } : undefined,
      first: section.limit,
    }),
    enabled: Boolean(categoryId),
  });
  const products = data?.edges.map((edge) => edge.node) ?? [];

  // A configured section whose category isn't in the catalog is skipped quietly.
  if (!categoryId || products.length === 0) return null;

  return (
    <section>
      <SectionHeading
        title={section.title}
        subtitle={section.subtitle}
        action={
          <Link
            to="/products"
            search={{ category: section.categorySlug }}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        }
      />
      <ProductGrid products={products} />
    </section>
  );
}
