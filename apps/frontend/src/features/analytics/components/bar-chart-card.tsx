import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import { ChartCard, EmptyState } from "./chart-card";

export type BarDatum = { label: string; value: number };

/**
 * Vertical bar chart in a card. Category on the X axis, one numeric series.
 *
 * Deliberately one hue: the reader's job here is comparing magnitude, so colour
 * carries no identity and a per-bar rainbow would imply a distinction that
 * doesn't exist. Grid and axes stay recessive; the bars are the ink.
 */
export function BarChartCard({
  title,
  description,
  icon,
  action,
  data,
  valueLabel,
  formatValue,
  emptyLabel = "No data for this period",
  emptyDetail,
  maxLabel = 12,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  data: BarDatum[];
  valueLabel: string;
  formatValue: (v: number) => string;
  emptyLabel?: string;
  emptyDetail?: React.ReactNode;
  /** Truncate X-axis labels longer than this (full text stays in the tooltip). */
  maxLabel?: number;
}) {
  const config: ChartConfig = {
    value: { label: valueLabel, color: "hsl(var(--chart-1))" },
  };

  return (
    <ChartCard
      title={title}
      description={description}
      icon={icon}
      action={action}
    >
      {data.length === 0 ? (
        <EmptyState message={emptyLabel} detail={emptyDetail} />
      ) : (
        <ChartContainer config={config} className="h-60 w-full">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={0}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: string) =>
                v.length > maxLabel ? `${v.slice(0, maxLabel - 1)}…` : v
              }
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: number) => formatValue(v)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => formatValue(value as number)}
                />
              }
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={4} />
          </BarChart>
        </ChartContainer>
      )}
    </ChartCard>
  );
}
