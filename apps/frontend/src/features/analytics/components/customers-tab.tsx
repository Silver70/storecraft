import { useSuspenseQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { UsersIcon, UserPlusIcon } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import { ChartCard } from "./chart-card";
import type { Period, CustomersAnalytics } from "~/types/api";
import { customersAnalyticsQueryOptions } from "../queries";
import { num, series } from "../utils";
import { MetricTile } from "./metric-tile";
import { DonutChart, type DonutSlice } from "./donut-chart";

const growthConfig: ChartConfig = {
  count: { label: "New customers", color: "hsl(var(--chart-1))" },
};

export function CustomersTab({ period }: { period: Period }) {
  const data: CustomersAnalytics = useSuspenseQuery(
    customersAnalyticsQueryOptions(period),
  ).data;

  const growth = data.growth.map((g) => ({
    date: new Date(g.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    count: g.count,
  }));

  const splitSlices: DonutSlice[] = [
    {
      name: "new",
      value: data.newVsReturning.newCustomers,
      color: series(0),
    },
    {
      name: "returning",
      value: data.newVsReturning.returning,
      color: series(1),
    },
  ];
  const splitTotal =
    data.newVsReturning.newCustomers + data.newVsReturning.returning;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricTile
          label="Total customers"
          value={num(data.totalCustomers)}
          icon={UsersIcon}
          hint="Across the organization"
        />
        <MetricTile
          label="New this period"
          value={num(data.newInPeriod)}
          icon={UserPlusIcon}
        />
        <MetricTile
          label="Returning order share"
          value={
            splitTotal > 0
              ? `${Math.round((data.newVsReturning.returning / splitTotal) * 100)}%`
              : "0%"
          }
          icon={UsersIcon}
          hint={`${data.newVsReturning.returning} of ${splitTotal} orders`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          title="New customers"
          description="Sign-ups per day this period"
          icon={UserPlusIcon}
          className="lg:col-span-2"
        >
          <ChartContainer config={growthConfig} className="h-56 w-full">
            <AreaChart
              data={growth}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
              <defs>
                <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--chart-1))"
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--chart-1))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={32}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                fill="url(#custGrad)"
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        </ChartCard>

        <DonutChart
          title="New vs. returning"
          description="Orders placed this period"
          data={splitSlices}
          centerValue={String(splitTotal)}
          centerLabel="orders"
        />
      </div>
    </div>
  );
}
