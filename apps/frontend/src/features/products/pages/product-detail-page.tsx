import * as React from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import type { Product } from "~/types/api";
import { formatPrice } from "~/lib/money";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { productQueryOptions } from "../queries";
import { deleteMediaServerFn, uploadMediaServerFn } from "../server";
import { priceRange } from "../utils";
import { DeleteProductButton } from "../components/delete-product-button";
import { OptionsCard } from "../components/options-card";
import { ProductEditForm } from "../components/product-edit-form";
import { ProductMediaGallery } from "../components/product-media-gallery";
import { ProductStatusBadge } from "../components/product-status-badge";
import { ProductThumbnail } from "../components/product-thumbnail";
import { ProductVariantsTable } from "../components/variants-table";

const route = getRouteApi("/admin/products_/$productId");

export function ProductDetailPage() {
  const { productId } = route.useParams();
  const queryClient = useQueryClient();
  const product: Product = useSuspenseQuery(
    productQueryOptions(productId),
  ).data;

  const [isEditing, setIsEditing] = React.useState(false);

  // Media mutations
  const uploadMediaMutation = useMutation({
    mutationFn: async (file: File) => {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );
      return uploadMediaServerFn({
        data: {
          productId,
          fileBase64: base64,
          mimeType: file.type,
          fileName: file.name,
          position: product.media.length,
        },
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: productQueryOptions(productId).queryKey,
      }),
  });

  const deleteMediaMutation = useMutation({
    mutationFn: (mediaId: string) =>
      deleteMediaServerFn({ data: { productId, mediaId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: productQueryOptions(productId).queryKey,
      }),
  });

  // Stock data lives in the inventory module — placeholders until inventory is wired
  const lowStockCount: number = 0;
  const outOfStockCount: number = 0;
  const activeCount = product.variants.filter((v) => v.isActive).length;
  const onSaleCount = product.variants.filter(
    (v) => v.compareAtPrice != null && v.compareAtPrice > 0,
  ).length;

  const { min: priceMin, max: priceMax } = priceRange(product.variants);
  const priceLabel =
    product.variants.length === 0
      ? "—"
      : priceMin === priceMax
        ? formatPrice(priceMin)
        : `${formatPrice(priceMin)} – ${formatPrice(priceMax)}`;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <nav className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
          <Link
            to="/admin/products"
            className="transition-colors hover:text-foreground"
          >
            Products
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{product.name}</span>
        </nav>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ProductThumbnail name={product.name} />
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-semibold">{product.name}</h1>
                <ProductStatusBadge status={product.status} />
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {product.variants.length} variant
                {product.variants.length !== 1 ? "s" : ""}
                {" · "}
                {priceLabel}
                {product.vendor ? ` · ${product.vendor}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {product.status === "active" && (
              <Button variant="outline" asChild>
                <Link to="/admin/store" search={{ productSlug: product.slug }}>
                  Edit in Store
                </Link>
              </Button>
            )}
            {isEditing ? (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setIsEditing(false)}
              >
                <XIcon className="h-4 w-4" />
                Cancel editing
              </Button>
            ) : (
              <Button
                className="gap-2"
                onClick={() => setIsEditing(true)}
              >
                <PencilIcon className="h-4 w-4" />
                Edit product
              </Button>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="mt-3 flex items-center justify-end">
            <DeleteProductButton productId={productId} />
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Edit form or description */}
          {isEditing ? (
            <ProductEditForm
              product={product}
              onSaved={() => setIsEditing(false)}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Description
                </CardTitle>
              </CardHeader>
              <CardContent>
                {product.description ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {product.description}
                  </p>
                ) : (
                  <p className="text-sm italic text-muted-foreground/60">
                    No description added.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Media */}
          <ProductMediaGallery
            images={product.media}
            isEditing={isEditing}
            onUpload={(file) => uploadMediaMutation.mutate(file)}
            onDelete={(mediaId) => deleteMediaMutation.mutate(mediaId)}
          />

          {/* Options */}
          {product.options.length > 0 && (
            <OptionsCard options={product.options} />
          )}

          {/* Variants */}
          <ProductVariantsTable
            variants={product.variants}
            productId={productId}
            isEditing={isEditing}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Product info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Product info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <ProductStatusBadge status={product.status} />
              </div>
              <Separator />
              <div className="flex items-start justify-between gap-2">
                <span className="shrink-0 text-muted-foreground">Slug</span>
                <span className="break-all text-right font-mono text-xs">
                  {product.slug}
                </span>
              </div>
              {product.vendor && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Vendor</span>
                    <span>{product.vendor}</span>
                  </div>
                </>
              )}
              {(product.tags ?? []).length > 0 && (
                <>
                  <Separator />
                  <div className="flex items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Tags</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {(product.tags ?? []).map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="text-xs font-normal"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(product.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last updated</span>
                <span>{new Date(product.updatedAt).toLocaleDateString()}</span>
              </div>
            </CardContent>
          </Card>

          {/* Inventory */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Inventory
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total in stock</span>
                <span className="font-semibold tabular-nums text-muted-foreground">
                  — (see Inventory)
                </span>
              </div>
              {lowStockCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Low stock</span>
                  <span className="flex items-center gap-1.5 font-medium tabular-nums text-amber-600 dark:text-amber-400">
                    <AlertTriangleIcon className="h-3.5 w-3.5" />
                    {lowStockCount} variant{lowStockCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {outOfStockCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Out of stock</span>
                  <span className="font-medium tabular-nums text-destructive">
                    {outOfStockCount} variant{outOfStockCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total variants</span>
                <span className="tabular-nums">{product.variants.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Active</span>
                <span className="tabular-nums">{activeCount}</span>
              </div>
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Price range</span>
                <span className="font-semibold tabular-nums">{priceLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">On sale</span>
                <span className="tabular-nums">
                  {onSaleCount > 0
                    ? `${onSaleCount} variant${onSaleCount !== 1 ? "s" : ""}`
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
