import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ShoppingCartIcon,
  XCircleIcon,
  RotateCcwIcon,
  DollarSignIcon,
} from "lucide-react";
import type { Period, OrdersAnalytics, OrderStatus } from "~/types/api";
import { ordersAnalyticsQueryOptions } from "../queries";
import { money, SERIES } from "../utils";
import { MetricTile } from "./metric-tile";
import { DonutChart, type DonutSlice } from "./donut-chart";

// Order status is an identity dimension, so each status is pinned to a fixed
// series slot. Pinning matters: the donut reorders by count, and a colour that
// followed rank instead of entity would repaint the chart on every refresh.
const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: SERIES[4],
  paid: SERIES[0],
  processing: SERIES[3],
  shipped: SERIES[6],
  delivered: SERIES[2],
  refunded: SERIES[1],
  cancelled: SERIES[7],
};

export function OrdersTab({ period }: { period: Period }) {
  const data: OrdersAnalytics = useSuspenseQuery(
    ordersAnalyticsQueryOptions(period),
  ).data;

  const totalOrders = data.statusBreakdown.reduce((s, r) => s + r.count, 0);
  const statusSlices: DonutSlice[] = data.statusBreakdown.map((r) => ({
    name: r.status,
    value: r.count,
    color: STATUS_COLORS[r.status] ?? SERIES[4],
  }));

  // Payment outcome is genuinely a state, not an identity — the one place the
  // reserved status palette belongs. Each slice is labelled, so the meaning
  // never rests on hue alone.
  const paymentSlices: DonutSlice[] = [
    {
      name: "captured",
      value: data.payments.captured,
      color: "hsl(var(--status-good))",
    },
    {
      name: "failed",
      value: data.payments.failed,
      color: "hsl(var(--status-critical))",
    },
    {
      name: "pending",
      value: data.payments.pending,
      color: "hsl(var(--status-warning))",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Cart abandonment"
          value={`${data.cartAbandonment.abandonmentRatePct}%`}
          icon={XCircleIcon}
          hint={`${data.cartAbandonment.abandonedCount} abandoned · ${data.cartAbandonment.convertedCount} converted`}
        />
        <MetricTile
          label="Lost cart value"
          value={money(data.cartAbandonment.lostValue)}
          icon={ShoppingCartIcon}
          hint="Total of abandoned carts"
        />
        <MetricTile
          label="Refund rate"
          value={`${data.refunds.refundRatePct}%`}
          icon={RotateCcwIcon}
          status={data.refunds.refundRatePct > 0 ? "warning" : undefined}
          hint={`${data.refunds.count} refunds`}
        />
        <MetricTile
          label="Refunded"
          value={money(data.refunds.amount)}
          icon={DollarSignIcon}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutChart
          title="Orders by status"
          description="All orders created this period"
          data={statusSlices}
          centerValue={String(totalOrders)}
          centerLabel="orders"
        />
        <DonutChart
          title="Payments"
          description="Capture success vs. failure"
          data={paymentSlices}
          centerValue={`${data.payments.successRatePct}%`}
          centerLabel="success"
        />
      </div>
    </div>
  );
}
