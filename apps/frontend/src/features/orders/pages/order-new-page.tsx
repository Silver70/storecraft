import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CreditCardIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  UserIcon,
  XIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { formatPrice, toCents } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { Coupon, Customer, ShippingMethod } from "~/types/api";
import {
  customersQueryOptions,
  customerAddressesQueryOptions,
} from "~/features/customers/queries";
import { couponsQueryOptions } from "~/features/discounts/queries";
import { shippingMethodsQueryOptions } from "~/features/shipping/queries";
import { ProductSearch } from "../components/product-search";
import { ShippingAddressSheet } from "../components/shipping-address-sheet";
import { createOrderServerFn, type CreateOrderInput } from "../server";
import { customerAddressToShipping } from "../utils";
import type {
  AppliedDiscount,
  CatalogVariant,
  LineItem,
  ShippingAddress,
} from "../types";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card_manual: "Card (manual entry)",
  cheque: "Cheque",
  other: "Other",
};

function customerName(c: Pick<Customer, "firstName" | "lastName" | "email">) {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email;
}

/** cents → editable dollar string (no forced decimals while typing). */
function priceToInput(cents: number) {
  return (cents / 100).toString();
}

/** Human-readable delivery estimate from a method's estimated-days range. */
function estimatedDelivery(m: ShippingMethod): string {
  const { estimatedDaysMin: min, estimatedDaysMax: max } = m;
  if (min != null && max != null) {
    return min === max
      ? `${min} business day${min === 1 ? "" : "s"}`
      : `${min}–${max} business days`;
  }
  if (max != null) return `Up to ${max} business days`;
  if (min != null) return `${min}+ business days`;
  return m.rateType === "free" ? "Free shipping" : "Delivery estimate varies";
}

/** Human-readable summary of an applied coupon for the summary card. */
function couponLabel(c: Coupon): string {
  if (c.type === "free_shipping") return `${c.code} — Free shipping`;
  if (c.type === "percentage") return `${c.code} — ${c.value / 100}% off`;
  return `${c.code} — ${formatPrice(c.value)} off`;
}

export function OrderNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Line items (prices in cents)
  const [items, setItems] = React.useState<LineItem[]>([]);

  // Customer
  const [customer, setCustomer] = React.useState<Customer | null>(null);
  const [custQuery, setCustQuery] = React.useState("");
  const [custFocused, setCustFocused] = React.useState(false);

  const {
    data: customersPage,
    isLoading: customersLoading,
    isError: customersError,
    error: customersErrorObj,
  } = useQuery(customersQueryOptions({ limit: 100 }));
  const customers = customersPage?.items ?? [];

  // Shipping address — defaults to the customer's saved (default) address; the
  // sheet lets the admin pick another saved address or enter a new one.
  const [shippingAddr, setShippingAddr] =
    React.useState<ShippingAddress | null>(null);
  const [addrSheetOpen, setAddrSheetOpen] = React.useState(false);

  const { data: customerAddresses = [], isLoading: addressesLoading } =
    useQuery({
      ...customerAddressesQueryOptions(customer?.id ?? ""),
      enabled: !!customer,
    });

  // Once a customer's addresses load, default the shipping address to their
  // default (or first) saved address. We only fill while it's still empty, so a
  // manual choice made via the sheet is never clobbered.
  React.useEffect(() => {
    if (!customer) {
      setShippingAddr(null);
      return;
    }
    if (shippingAddr) return;
    const def =
      customerAddresses.find((a) => a.isDefault) ?? customerAddresses[0];
    if (def) setShippingAddr(customerAddressToShipping(def));
  }, [customer, customerAddresses, shippingAddr]);

  // Shipping methods — sourced from the store admin's configured methods. We
  // show all active methods across zones (no zone filtering).
  const {
    data: shippingMethods = [],
    isLoading: shippingMethodsLoading,
    isError: shippingMethodsError,
  } = useQuery(shippingMethodsQueryOptions());
  const activeMethods = React.useMemo(
    () => shippingMethods.filter((m) => m.isActive),
    [shippingMethods],
  );

  // Order options
  const [shipping, setShipping] = React.useState("");

  // Default to the first active method once loaded; also recover if the chosen
  // method is no longer available (e.g. deactivated while the page is open).
  React.useEffect(() => {
    if (activeMethods.length === 0) return;
    if (!activeMethods.some((m) => m.id === shipping)) {
      setShipping(activeMethods[0].id);
    }
  }, [activeMethods, shipping]);
  const [paymentType, setPaymentType] = React.useState<"paid" | "invoice">(
    "paid",
  );
  const [paymentMethod, setPaymentMethod] = React.useState("cash");
  const [discountCode, setDiscountCode] = React.useState("");
  const [appliedDiscount, setAppliedDiscount] =
    React.useState<AppliedDiscount | null>(null);
  const [discountError, setDiscountError] = React.useState("");

  // Real coupons for the active store — used to validate an entered code.
  const { data: coupons = [] } = useQuery(couponsQueryOptions());
  const [note, setNote] = React.useState("");
  const [formError, setFormError] = React.useState("");

  // ─── Computed totals (all in cents) ──────────────────────────────────────

  const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  // Method prices are already stored in cents — no conversion needed.
  const shippingCost = activeMethods.find((m) => m.id === shipping)?.price ?? 0;
  // A free_shipping coupon zeroes out the shipping charge; percentage/fixed
  // coupons reduce the subtotal instead. Value units mirror the backend Coupon:
  // percentage = basis points (2000 = 20%), fixed_amount = cents. Mirrors
  // computeCouponAmount in the backend pricing engine.
  const isFreeShipping = appliedDiscount?.type === "free_shipping";
  const effectiveShipping = isFreeShipping ? 0 : shippingCost;
  const discountAmount =
    appliedDiscount?.type === "percentage"
      ? Math.round((subtotal * appliedDiscount.value) / 10000)
      : appliedDiscount?.type === "fixed_amount"
        ? Math.min(appliedDiscount.value, subtotal)
        : 0;
  const taxAmount = Math.round((subtotal - discountAmount) * 0.06);
  const total = subtotal - discountAmount + taxAmount + effectiveShipping;

  // ─── Actions ─────────────────────────────────────────────────────────────

  function addItem(v: CatalogVariant) {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === v.variantId);
      if (existing)
        return prev.map((i) =>
          i.variantId === v.variantId ? { ...i, qty: i.qty + 1 } : i,
        );
      return [
        ...prev,
        {
          variantId: v.variantId,
          productName: v.productName,
          variantName: v.variantName,
          sku: v.sku,
          imageUrl: v.imageUrl,
          qty: 1,
          unitPrice: v.unitPrice,
        },
      ];
    });
  }

  function setQty(variantId: string, qty: number) {
    if (qty < 1) return;
    setItems((prev) =>
      prev.map((i) => (i.variantId === variantId ? { ...i, qty } : i)),
    );
  }

  function setPrice(variantId: string, raw: string) {
    const cents = toCents(raw);
    setItems((prev) =>
      prev.map((i) =>
        i.variantId === variantId ? { ...i, unitPrice: cents } : i,
      ),
    );
  }

  function removeItem(variantId: string) {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId));
  }

  function selectCustomer(c: Customer) {
    setCustomer(c);
    setCustQuery("");
    // Reset so the effect repopulates from the newly-selected customer's
    // default saved address.
    setShippingAddr(null);
  }

  function applyDiscount() {
    const key = discountCode.trim().toUpperCase();
    const coupon = coupons.find((c) => c.code.toUpperCase() === key);

    // Reject with a specific reason so the admin can tell why a code failed.
    if (!coupon) {
      setAppliedDiscount(null);
      setDiscountError("Invalid or expired code.");
      return;
    }
    const now = new Date();
    if (!coupon.isActive) {
      setAppliedDiscount(null);
      setDiscountError("This code is no longer active.");
      return;
    }
    if (coupon.startsAt && new Date(coupon.startsAt) > now) {
      setAppliedDiscount(null);
      setDiscountError("This code is not active yet.");
      return;
    }
    if (coupon.endsAt && new Date(coupon.endsAt) < now) {
      setAppliedDiscount(null);
      setDiscountError("This code has expired.");
      return;
    }
    if (
      coupon.maxUsageCount !== null &&
      coupon.usageCount >= coupon.maxUsageCount
    ) {
      setAppliedDiscount(null);
      setDiscountError("This code has reached its usage limit.");
      return;
    }
    if (coupon.minOrderAmount !== null && subtotal < coupon.minOrderAmount) {
      setAppliedDiscount(null);
      setDiscountError(
        `Requires a minimum subtotal of ${formatPrice(coupon.minOrderAmount)}.`,
      );
      return;
    }

    setAppliedDiscount({
      type: coupon.type,
      value: coupon.value,
      label: couponLabel(coupon),
    });
    setDiscountError("");
  }

  const custResults =
    custQuery.length > 0
      ? customers
          .filter((c) => {
            const q = custQuery.toLowerCase();
            return (
              customerName(c).toLowerCase().includes(q) ||
              c.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 8)
      : [];

  const canCreate =
    items.length > 0 && customer !== null && shippingAddr !== null;

  // ─── Submit ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: CreateOrderInput) =>
      createOrderServerFn({ data: payload }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate({
        to: "/admin/orders/$orderId",
        params: { orderId: order.id },
      });
    },
    onError: (err) => {
      setFormError(
        err instanceof Error ? err.message : "Failed to create order",
      );
    },
  });

  function handleCreate() {
    if (!customer || items.length === 0) return;
    if (!shippingAddr) {
      setFormError("Add a shipping address before creating the order.");
      return;
    }

    // Backstop validation (the address sheet validates on entry too).
    const a = shippingAddr;
    const required: [keyof ShippingAddress, string][] = [
      ["firstName", "first name"],
      ["lastName", "last name"],
      ["line1", "street address"],
      ["city", "city"],
      ["postalCode", "ZIP / postal code"],
    ];
    for (const [field, label] of required) {
      if (!a[field].trim()) {
        setFormError(`Shipping address is missing a ${label}.`);
        return;
      }
    }
    if (a.countryCode.trim().length !== 2) {
      setFormError("Country must be a 2-letter code (e.g. US).");
      return;
    }

    const notes = [
      note.trim() || null,
      paymentType === "paid"
        ? `Payment method: ${PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const payload: CreateOrderInput = {
      customerEmail: customer.email,
      customerName: customerName(customer),
      customerId: customer.id,
      items: items.map((i) => ({
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName ?? undefined,
        sku: i.sku ?? undefined,
        quantity: i.qty,
        unitPrice: i.unitPrice,
      })),
      shippingAddress: {
        firstName: a.firstName.trim(),
        lastName: a.lastName.trim(),
        company: a.company.trim() || undefined,
        line1: a.line1.trim(),
        line2: a.line2.trim() || undefined,
        city: a.city.trim(),
        state: a.state.trim() || undefined,
        postalCode: a.postalCode.trim(),
        countryCode: a.countryCode.trim().toUpperCase(),
        phone: a.phone.trim() || undefined,
      },
      paymentType,
      shippingAmount: effectiveShipping,
      discountAmount,
      taxAmount,
      couponCode: appliedDiscount
        ? discountCode.trim().toUpperCase()
        : undefined,
      notes: notes || undefined,
    };

    setFormError("");
    createMutation.mutate(payload);
  }

  const isPending = createMutation.isPending;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-10">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link
              to="/admin/orders"
              className="flex items-center gap-1 transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              Orders
            </Link>
            <ChevronRightIcon className="h-3.5 w-3.5" />
            <span className="text-foreground">New order</span>
          </div>
          <h1 className="text-2xl font-semibold">Create order</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manually place an order on behalf of a customer.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="lg" className="h-9 px-4" asChild>
            <Link to="/admin/orders">Discard</Link>
          </Button>
          <Button
            size="lg"
            disabled={!canCreate || isPending}
            onClick={handleCreate}
            className="h-9 px-5"
          >
            {isPending ? (
              <LoaderCircleIcon className="h-4 w-4 animate-spin" />
            ) : (
              "Create order"
            )}
          </Button>
        </div>
      </div>

      {/* Form-level error */}
      {formError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      {/* Two-column grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        {/* ── Left: product search + line items + note ──────────────────── */}
        <div className="space-y-5">
          {/* Product search — overflow-visible + raised z so the results
              dropdown isn't clipped by the card or hidden behind the next one */}
          <Card className="relative z-20 overflow-visible">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">
                Add products
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ProductSearch onAdd={addItem} />
            </CardContent>
          </Card>

          {/* Line items */}
          <Card className="overflow-hidden gap-0 py-0">
            <div className="flex items-center justify-between px-5 py-4">
              <p className="text-sm font-semibold">Line items</p>
              {items.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {items.length} item{items.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center border-t py-12 text-center">
                <PackageIcon className="mb-3 h-8 w-8 text-muted-foreground/25" />
                <p className="text-sm font-medium text-muted-foreground">
                  No items yet
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  Search for products above to add them.
                </p>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="flex items-center gap-3 border-t border-b bg-muted/20 px-5 py-2.5 text-xs font-medium text-muted-foreground">
                  <span className="flex-1">Product</span>
                  <span className="w-24 text-right">Unit price</span>
                  <span className="w-28 text-center">Qty</span>
                  <span className="w-16 text-right">Total</span>
                  <span className="w-7 shrink-0" />
                </div>

                {/* Rows */}
                {items.map((item) => (
                  <div
                    key={item.variantId}
                    className="flex items-center gap-3 border-b border-border/50 px-5 py-3.5 last:border-0"
                  >
                    {/* Product info */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <PackageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-snug">
                          {item.productName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.variantName && `${item.variantName} · `}
                          <span className="font-mono">{item.sku ?? "—"}</span>
                        </p>
                      </div>
                    </div>

                    {/* Unit price */}
                    <div className="relative w-24 shrink-0">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        $
                      </span>
                      <Input
                        value={priceToInput(item.unitPrice)}
                        onChange={(e) =>
                          setPrice(item.variantId, e.target.value)
                        }
                        className="h-8 pl-5 text-right text-sm tabular-nums"
                      />
                    </div>

                    {/* Qty stepper */}
                    <div className="flex w-28 shrink-0 justify-center">
                      <div className="flex items-center overflow-hidden rounded-lg border border-border">
                        <button
                          type="button"
                          onClick={() => setQty(item.variantId, item.qty - 1)}
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <MinusIcon className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-8 border-x border-border text-center text-sm tabular-nums leading-8">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(item.variantId, item.qty + 1)}
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Line total */}
                    <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {formatPrice(item.qty * item.unitPrice)}
                    </span>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeItem(item.variantId)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </>
            )}
          </Card>

          {/* Note */}
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">Note</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Internal note — not visible to the customer…"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/50"
              />
            </CardContent>
          </Card>
        </div>

        {/* ── Right: customer, address, shipping, payment, summary ──────── */}
        <div className="space-y-5">
          {/* Customer — overflow-visible + raised z so the search results
              dropdown isn't clipped by the card or hidden behind the next one */}
          <Card className="relative z-20 overflow-visible">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">Customer</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {customer ? (
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium">
                      {customerName(customer)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {customer.email}
                    </p>
                    {customer.phone && (
                      <p className="text-xs text-muted-foreground">
                        {customer.phone}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomer(null)}
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={custQuery}
                    onChange={(e) => setCustQuery(e.target.value)}
                    onFocus={() => setCustFocused(true)}
                    onBlur={() => setTimeout(() => setCustFocused(false), 120)}
                    placeholder="Search by name or email…"
                    className="h-9 pl-8 text-sm"
                  />
                  {custFocused && custQuery.length > 0 && (
                    <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                      {customersError ? (
                        <div className="px-4 py-5 text-center">
                          <p className="text-sm text-destructive">
                            Couldn't load customers.
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {customersErrorObj instanceof Error
                              ? customersErrorObj.message
                              : "Please try again."}
                          </p>
                        </div>
                      ) : customersLoading ? (
                        <div className="flex items-center justify-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                          <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                          Loading customers…
                        </div>
                      ) : custResults.length > 0 ? (
                        custResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={() => selectCustomer(c)}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">
                                {customerName(c)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {c.email}
                              </p>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-5 text-center">
                          <p className="text-sm text-muted-foreground">
                            No customers found.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shipping address — defaults to the customer's saved address */}
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">
                Shipping address
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {!customer ? (
                <p className="text-sm text-muted-foreground">
                  Select a customer to set the shipping address.
                </p>
              ) : addressesLoading && !shippingAddr ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                  Loading addresses…
                </div>
              ) : shippingAddr ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <MapPinIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">
                        {shippingAddr.firstName} {shippingAddr.lastName}
                      </p>
                      {shippingAddr.company && (
                        <p className="text-muted-foreground">
                          {shippingAddr.company}
                        </p>
                      )}
                      <p className="text-muted-foreground">
                        {shippingAddr.line1}
                        {shippingAddr.line2 ? `, ${shippingAddr.line2}` : ""}
                      </p>
                      <p className="text-muted-foreground">
                        {[
                          shippingAddr.city,
                          shippingAddr.state,
                          shippingAddr.postalCode,
                        ]
                          .filter(Boolean)
                          .join(", ")}{" "}
                        {shippingAddr.countryCode}
                      </p>
                      {shippingAddr.phone && (
                        <p className="text-muted-foreground">
                          {shippingAddr.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddrSheetOpen(true)}
                    className="text-xs font-medium text-orange-700 hover:text-orange-800"
                  >
                    Use a different address
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted-foreground">
                    This customer has no saved address yet.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setAddrSheetOpen(true)}
                  >
                    <MapPinIcon className="mr-1.5 h-3.5 w-3.5" />
                    Add shipping address
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {customer && (
            <ShippingAddressSheet
              open={addrSheetOpen}
              onOpenChange={setAddrSheetOpen}
              customerId={customer.id}
              addresses={customerAddresses}
              onSelect={setShippingAddr}
            />
          )}

          {/* Shipping method */}
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">
                Shipping method
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-4">
              {shippingMethodsLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                  Loading shipping methods…
                </div>
              ) : shippingMethodsError ? (
                <p className="py-2 text-sm text-destructive">
                  Couldn't load shipping methods.
                </p>
              ) : activeMethods.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No active shipping methods. Configure them under{" "}
                  <Link
                    to="/admin/shipping"
                    className="font-medium text-orange-700 hover:text-orange-800"
                  >
                    Shipping
                  </Link>
                  .
                </p>
              ) : (
                activeMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setShipping(m.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
                      shipping === m.id
                        ? "border-amber-400 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        shipping === m.id
                          ? "border-amber-500"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {shipping === m.id && (
                        <div className="h-2 w-2 rounded-full bg-amber-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {estimatedDelivery(m)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {m.rateType === "free" || m.price === 0
                        ? "Free"
                        : formatPrice(m.price)}
                    </span>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Payment */}
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* Toggle */}
              <div className="flex overflow-hidden rounded-lg border border-border">
                {(["paid", "invoice"] as const).map((type, i) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPaymentType(type)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
                      i > 0 && "border-l border-border",
                      paymentType === type
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {type === "paid" ? (
                      <>
                        <CreditCardIcon className="h-3.5 w-3.5" /> Mark as paid
                      </>
                    ) : (
                      <>
                        <FileTextIcon className="h-3.5 w-3.5" /> Send invoice
                      </>
                    )}
                  </button>
                ))}
              </div>

              {paymentType === "paid" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Payment method
                  </Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={setPaymentMethod}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">
                        Bank transfer
                      </SelectItem>
                      <SelectItem value="card_manual">
                        Card (manual entry)
                      </SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    An invoice will be emailed to{" "}
                    <span className="font-medium text-foreground">
                      {customer?.email ?? "the customer"}
                    </span>{" "}
                    with a payment link. The order will be created in{" "}
                    <em>pending</em> status until payment is received.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order summary */}
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-sm font-semibold">
                Order summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* Discount */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <TagIcon className="h-3 w-3" />
                  Discount code
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={discountCode}
                    onChange={(e) => {
                      setDiscountCode(e.target.value);
                      setDiscountError("");
                      if (appliedDiscount) setAppliedDiscount(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && applyDiscount()}
                    placeholder="e.g. SUMMER20"
                    className="h-8 flex-1 font-mono text-sm uppercase"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!discountCode.trim()}
                    onClick={applyDiscount}
                  >
                    Apply
                  </Button>
                </div>
                {appliedDiscount && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <span>{appliedDiscount.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedDiscount(null);
                        setDiscountCode("");
                      }}
                      className="ml-auto text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {discountError && (
                  <p className="text-xs text-destructive">{discountError}</p>
                )}
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Shipping</span>
                  <span className="tabular-nums">
                    {isFreeShipping ? (
                      <>
                        {shippingCost > 0 && (
                          <span className="mr-1.5 text-muted-foreground/60 line-through">
                            {formatPrice(shippingCost)}
                          </span>
                        )}
                        <span className="text-emerald-600">Free</span>
                      </>
                    ) : effectiveShipping === 0 ? (
                      "Free"
                    ) : (
                      formatPrice(effectiveShipping)
                    )}
                  </span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount</span>
                    <span className="tabular-nums">
                      −{formatPrice(discountAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax (GST 6%)</span>
                  <span className="tabular-nums">{formatPrice(taxAmount)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatPrice(total)}</span>
                </div>
              </div>

              <Button
                onClick={handleCreate}
                className="w-full"
                disabled={!canCreate || isPending}
              >
                {isPending ? (
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                ) : (
                  "Create order"
                )}
              </Button>

              {!canCreate && (
                <p className="text-center text-xs text-muted-foreground">
                  {items.length === 0
                    ? "Add at least one product to continue."
                    : !customer
                      ? "Select a customer to continue."
                      : "Add a shipping address to continue."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
