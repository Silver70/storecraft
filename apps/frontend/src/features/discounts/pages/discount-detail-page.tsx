import * as React from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeftIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { Coupon, Discount, DiscountType } from "~/types/api";
import {
  couponsQueryOptions,
  discountQueryOptions,
  discountsQueryOptions,
} from "../queries";
import { updateDiscountServerFn } from "../server";
import { computeDiscountStatus } from "../utils";
import { DiscountStatusBadge } from "../components/discount-status-badge";
import { DeleteDiscountButton } from "../components/delete-discount-button";
import { CouponCodesCard } from "../components/coupon-codes-card";
import type { AppliesTo } from "../types";

const updateDiscountSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["percentage", "fixed_amount"]),
  value: z.coerce.number().positive("Value must be positive"),
  scope: z.enum(["product", "category", "order"]),
  scopeId: z.string().optional(),
  minOrderAmount: z.coerce.number().min(0).optional(),
  isActive: z.boolean(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

const route = getRouteApi("/admin/discounts_/$discountId");

export function DiscountDetailPage() {
  const { discountId } = route.useParams();
  const queryClient = useQueryClient();

  const discount: Discount = useSuspenseQuery(
    discountQueryOptions(discountId),
  ).data;
  const allCoupons: Coupon[] = useQuery(couponsQueryOptions()).data ?? [];

  // Discount details
  const [name, setName] = React.useState(discount.name);
  const [type, setType] = React.useState<DiscountType>(discount.type);
  // Stored in hundredths (cents / basis points); the input shows the
  // human unit — dollars or whole percent.
  const [value, setValue] = React.useState(String(discount.value / 100));
  const [appliesTo, setAppliesTo] = React.useState<AppliesTo>(discount.scope);
  const [category, setCategory] = React.useState(
    discount.scope === "category" ? (discount.scopeId ?? "") : "",
  );
  const [product, setProduct] = React.useState(
    discount.scope === "product" ? (discount.scopeId ?? "") : "",
  );

  // Conditions
  const [minPurchase, setMinPurchase] = React.useState(
    discount.minOrderAmount != null
      ? String(discount.minOrderAmount / 100)
      : "",
  );
  const [startDate, setStartDate] = React.useState(
    discount.startsAt ? discount.startsAt.slice(0, 10) : "",
  );
  const [endDate, setEndDate] = React.useState(
    discount.endsAt ? discount.endsAt.slice(0, 10) : "",
  );
  const [noEndDate, setNoEndDate] = React.useState(!discount.endsAt);

  // Errors
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const canSave = name.trim().length > 0 && value.trim().length > 0;

  const updateMutation = useMutation({
    mutationFn: () => {
      // Both units are hundredths of their display unit: fixed_amount dollars
      // become cents, percentage becomes basis points (20 -> 2000).
      const sentValue = Math.round(parseFloat(value) * 100);

      const payload = {
        name: name.trim(),
        type,
        value: sentValue,
        scope: appliesTo,
        scopeId:
          appliesTo === "category"
            ? category || undefined
            : appliesTo === "product"
              ? product || undefined
              : undefined,
        minOrderAmount: minPurchase
          ? Math.round(parseFloat(minPurchase) * 100)
          : undefined,
        isActive: discount.isActive,
        startsAt: startDate ? new Date(startDate).toISOString() : undefined,
        endsAt:
          !noEndDate && endDate ? new Date(endDate).toISOString() : undefined,
      };

      const result = updateDiscountSchema.safeParse(payload);
      if (!result.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of result.error.issues) {
          fieldErrors[issue.path.join(".")] = issue.message;
        }
        setErrors(fieldErrors);
        return Promise.reject(new Error("Validation failed"));
      }
      setErrors({});
      return updateDiscountServerFn({ data: { discountId, ...result.data } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: discountQueryOptions(discountId).queryKey,
      });
      queryClient.invalidateQueries({
        queryKey: discountsQueryOptions().queryKey,
      });
    },
    onError: (err) => {
      if (err.message !== "Validation failed") {
        setErrors({
          _root: err instanceof Error ? err.message : "Failed to save discount",
        });
      }
    },
  });

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link
            to="/admin/discounts"
            className="flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Discounts
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" />
          <span className="text-foreground">{discount.name}</span>
        </div>

        <div className="flex items-center gap-3">
          {errors._root && (
            <p className="text-xs text-destructive">{errors._root}</p>
          )}
          <DeleteDiscountButton discountId={discountId} />
          <DiscountStatusBadge status={computeDiscountStatus(discount)} />
          <Button
            disabled={!canSave || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
            className="px-5"
          >
            {updateMutation.isPending ? (
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-5">
        {/* ── Discount Details ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Discount Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">
                Internal name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="d-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Visible only to admins, not shown to customers.
              </p>
            </div>

            <Separator />

            <div className="space-y-2.5">
              <Label>
                Discount type <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-col gap-2">
                {(["percentage", "fixed_amount"] as const).map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-2.5"
                    onClick={() => setType(t)}
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        type === t
                          ? "border-amber-500 bg-amber-500"
                          : "border-border bg-transparent",
                      )}
                    >
                      {type === t && (
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="text-sm">
                      {t === "percentage" ? "Percentage" : "Fixed amount"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="d-value">
                Value <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                {type === "fixed_amount" && (
                  <span className="text-sm text-muted-foreground">$</span>
                )}
                <Input
                  id="d-value"
                  type="number"
                  min={0}
                  step={type === "percentage" ? 1 : 0.01}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-32"
                />
                {type === "percentage" && (
                  <span className="text-sm text-muted-foreground">%</span>
                )}
              </div>
              {errors.value && (
                <p className="text-xs text-destructive">{errors.value}</p>
              )}
            </div>

            <Separator />

            <div className="space-y-2.5">
              <Label>
                Applies to <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-col gap-2">
                {(["order", "category", "product"] as const).map((scope) => (
                  <label
                    key={scope}
                    className="flex cursor-pointer items-center gap-2.5"
                    onClick={() => setAppliesTo(scope)}
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        appliesTo === scope
                          ? "border-amber-500 bg-amber-500"
                          : "border-border bg-transparent",
                      )}
                    >
                      {appliesTo === scope && (
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="text-sm">
                      {scope === "order" && "Entire order"}
                      {scope === "category" && "Specific category"}
                      {scope === "product" && "Specific product"}
                    </span>
                  </label>
                ))}
              </div>

              {appliesTo === "category" && (
                <div className="ml-7 mt-1">
                  <Input
                    placeholder="Category ID"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-56"
                  />
                </div>
              )}

              {appliesTo === "product" && (
                <div className="ml-7 mt-1">
                  <Input
                    placeholder="Product ID"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    className="w-56"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Conditions ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Conditions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="d-min">
                Minimum purchase amount{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="d-min"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={minPurchase}
                  onChange={(e) => setMinPurchase(e.target.value)}
                  className="w-36"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>
                Active period <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="d-start"
                    className="text-xs text-muted-foreground"
                  >
                    Start date
                  </Label>
                  <Input
                    id="d-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-40"
                  />
                </div>
                {!noEndDate && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="d-end"
                      className="text-xs text-muted-foreground"
                    >
                      End date
                    </Label>
                    <Input
                      id="d-end"
                      type="date"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                )}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <div
                  onClick={() => setNoEndDate((v) => !v)}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
                    noEndDate
                      ? "border-amber-500 bg-amber-500"
                      : "border-border bg-transparent",
                  )}
                >
                  {noEndDate && (
                    <svg
                      viewBox="0 0 10 8"
                      className="h-2.5 w-2.5 text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <polyline points="1 4 4 7 9 1" />
                    </svg>
                  )}
                </div>
                No end date
              </label>
            </div>
          </CardContent>
        </Card>

        {/* ── Coupon Codes ──────────────────────────────────────────────────── */}
        <CouponCodesCard discount={discount} coupons={allCoupons} />
      </div>
    </div>
  );
}
