import * as React from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { Order } from "~/types/api";
import { formatMoney } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { useReportPurchase } from "~/features/measurement/hooks";
import { orderStatusQueryOptions } from "../queries";

const route = getRouteApi("/order/confirmation");
const POLL_TIMEOUT_MS = 60_000;

export function OrderConfirmationPage() {
  const { orderNumber } = route.useSearch();
  const startedAt = React.useRef(Date.now());

  const { data: order, isLoading } = useQuery({
    ...orderStatusQueryOptions(orderNumber),
    enabled: orderNumber.length > 0,
    // Poll while the order is still pending (Stripe webhook flips it to paid),
    // giving up after a timeout so we don't poll forever.
    refetchInterval: (query) => {
      const current = query.state.data;
      if (current && current.status !== "pending") return false;
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) return false;
      return 3000;
    },
  });

  // Told to the ad platform from here as well as from the server, both under the
  // Order's id, so the platform counts one purchase. Only once the order is
  // confirmed: a pending one has not been paid for.
  useReportPurchase(order && order.status !== "pending" ? order : null);

  if (!orderNumber) {
    return <Centered message="No order specified." />;
  }
  if (isLoading) {
    return <Centered spinner message="Loading your order…" />;
  }
  if (!order) {
    return (
      <Centered message="We couldn’t find that order. If you just paid, give it a moment and refresh." />
    );
  }
  if (order.status === "pending") {
    return (
      <Centered
        spinner
        message="Confirming your payment… this can take a few seconds."
      />
    );
  }

  return <ConfirmedOrder order={order} />;
}

function ConfirmedOrder({ order }: { order: Order }) {
  const addr = order.shippingAddress;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex flex-col items-center text-center">
        <CheckCircle2 className="size-12 text-foreground" />
        <h1 className="mt-4 font-heading text-2xl font-semibold tracking-tight">
          Thank you for your order
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Order <span className="font-medium">{order.orderNumber}</span> is
          confirmed. A receipt has been sent to your email.
        </p>
      </div>

      <div className="mt-8 space-y-4 rounded-xl border p-4">
        {order.lineItems.map((item) => (
          <div key={item.id} className="flex items-center gap-3">
            <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
              {item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt={item.productName}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.productName}</p>
              {item.variantName && (
                <p className="text-xs text-muted-foreground">
                  {item.variantName}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Qty {item.quantity}
              </p>
            </div>
            <span className="text-sm">
              {formatMoney(item.totalPrice, order.currency)}
            </span>
          </div>
        ))}

        <Separator />

        <div className="space-y-1.5 text-sm">
          <Row
            label="Subtotal"
            value={formatMoney(order.subtotal, order.currency)}
          />
          {order.discountAmount > 0 && (
            <Row
              muted
              label="Discount"
              value={`−${formatMoney(order.discountAmount, order.currency)}`}
            />
          )}
          <Row
            label="Shipping"
            value={formatMoney(order.shippingAmount, order.currency)}
          />
          <Row
            label="Tax"
            value={formatMoney(order.taxAmount, order.currency)}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between font-medium">
          <span>Total</span>
          <span>{formatMoney(order.total, order.currency)}</span>
        </div>
      </div>

      <div className="mt-6 rounded-xl border p-4 text-sm">
        <p className="mb-1 font-medium">Shipping to</p>
        <p className="text-muted-foreground">
          {addr.firstName} {addr.lastName}
          <br />
          {addr.line1}
          {addr.line2 ? `, ${addr.line2}` : ""}
          <br />
          {addr.city}
          {addr.state ? `, ${addr.state}` : ""} {addr.postalCode}
          <br />
          {addr.countryCode}
        </p>
      </div>

      <div className="mt-8 flex justify-center">
        <Button asChild variant="outline">
          <Link to="/products">Continue shopping</Link>
        </Button>
      </div>
    </div>
  );
}

function Centered({
  message,
  spinner,
}: {
  message: string;
  spinner?: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      {spinner && (
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      )}
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link to="/products">Continue shopping</Link>
      </Button>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={
        muted
          ? "flex justify-between text-muted-foreground"
          : "flex justify-between"
      }
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
