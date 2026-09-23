import * as React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { BarChart3Icon, PercentIcon, ShoppingCartIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { DashboardStats, Period } from "~/types/api";
import { dashboardStatsQueryOptions } from "../queries";
import { sparklineToTrend } from "../utils";
import { KpiCard } from "../components/kpi-card";
import { OpsSnapshot } from "../components/ops-snapshot";
import { RevenueTrend } from "../components/revenue-trend";
import { RecentOrders } from "../components/recent-orders";

const PERIOD_LABELS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

export function DashboardPage() {
  const [period, setPeriod] = React.useState<Period>("7d");
  const stats: DashboardStats = useSuspenseQuery(
    dashboardStatsQueryOptions(period),
  ).data;

  const revenueTrend = sparklineToTrend(stats.revenue.sparkline, period);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back. Here&apos;s what&apos;s happening with your store.
          </p>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            {PERIOD_LABELS.map((p) => (
              <TabsTrigger key={p.value} value={p.value} className="text-xs">
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* compareValue is a static mockup for now — not wired to real
            prior-period data yet, see KpiCard. */}
        <KpiCard
          label="Revenue"
          subLabel="Total sales revenue"
          value={stats.revenue.current}
          delta={stats.revenue.delta}
          icon={BarChart3Icon}
          format="currency"
          compareValue="+$1,324"
        />
        <KpiCard
          label="Orders"
          subLabel="Total orders placed"
          value={stats.orders.current}
          delta={stats.orders.delta}
          icon={ShoppingCartIcon}
          format="number"
          compareValue="+38"
        />
        <KpiCard
          label="Conversion"
          subLabel="Checkout conversion rate"
          value={stats.conversion.current}
          delta={stats.conversion.delta}
          icon={PercentIcon}
          format="percent"
          compareValue="+0.4%"
        />
      </div>

      {/* Operational snapshot */}
      {/* <OpsSnapshot
        pendingOrders={stats.pendingOrders}
        processingOrders={stats.processingOrders}
        lowStockItems={stats.lowStockItems}
      /> */}

      {/* Revenue Chart — full width */}
      <RevenueTrend data={revenueTrend} />

      {/* Recent Orders */}
      <RecentOrders />
    </div>
  );
}
