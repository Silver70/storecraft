import * as React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  DollarSignIcon,
  PercentIcon,
  RepeatIcon,
  ShoppingCartIcon,
  TagIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { DashboardStats, Period } from "~/types/api";
import { dashboardStatsQueryOptions } from "../queries";
import { sparklineToTrend } from "../utils";
import { KpiCard } from "../components/kpi-card";
import { OpsSnapshot } from "../components/ops-snapshot";
import { RevenueTrend } from "../components/revenue-trend";
import { RecentOrders } from "../components/recent-orders";
import { SpendSummary } from "../components/spend-summary";

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
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Revenue"
          value={stats.revenue.current}
          delta={stats.revenue.delta}
          icon={DollarSignIcon}
          format="currency"
        />
        <KpiCard
          label="Orders"
          value={stats.orders.current}
          delta={stats.orders.delta}
          icon={ShoppingCartIcon}
          format="number"
        />
        <KpiCard
          label="Conversion"
          value={stats.conversion.current}
          delta={stats.conversion.delta}
          icon={PercentIcon}
          format="percent"
        />
        <KpiCard
          label="Avg Order Value"
          value={stats.aov.current}
          delta={stats.aov.delta}
          icon={TagIcon}
          format="currency"
        />
        <KpiCard
          label="Returning"
          value={stats.returning.current}
          delta={stats.returning.delta}
          icon={RepeatIcon}
          format="percent"
        />
      </div>

      {/* Operational snapshot */}
      {/* <OpsSnapshot
        pendingOrders={stats.pendingOrders}
        processingOrders={stats.processingOrders}
        lowStockItems={stats.lowStockItems}
      /> */}

      {/* What the ads cost, from the marketing module's own summary read.
          Composed here rather than served by the dashboard backend: a report
          module never depends on another report module, so the coupling lives
          on this page. It fetches independently and fails independently — see
          SpendSummary — so a marketing outage costs one card, not this page. */}
      <SpendSummary period={period} />

      {/* Revenue Chart — full width */}
      <RevenueTrend data={revenueTrend} />

      {/* Recent Orders */}
      <RecentOrders />
    </div>
  );
}
