import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import { ChartCard, EmptyState } from "./chart-card";

export type DonutSlice = { name: string; value: number; color: string };

/**
 * Part-to-whole donut with an inline legend. This is the one place categorical
 * colour is right — the slices *are* distinct things — so slices carry their own
 * hue from the fixed series order. The legend is always present and every row is
 * labelled with its value, so identity never rests on colour alone.
 */
export function DonutChart({
  title,
  description,
  icon,
  action,
  data,
  centerLabel,
  centerValue,
  emptyLabel = "No data for this period",
  emptyDetail,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  data: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
  emptyLabel?: string;
  emptyDetail?: React.ReactNode;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const config: ChartConfig = Object.fromEntries(
    data.map((d) => [d.name, { label: d.name, color: d.color }]),
  );

  return (
    <ChartCard
      title={title}
      description={description}
      icon={icon}
      action={action}
    >
      {total === 0 ? (
        <EmptyState message={emptyLabel} detail={emptyDetail} />
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="relative">
            <ChartContainer config={config} className="aspect-square h-44">
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent nameKey="name" hideLabel />}
                />
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={72}
                  paddingAngle={2}
                  strokeWidth={2}
                  stroke="var(--card)"
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            {centerValue ? (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold leading-none">
                  {centerValue}
                </span>
                {centerLabel ? (
                  <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {centerLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <ul className="w-full space-y-2 sm:w-auto sm:min-w-40">
            {data.map((d) => (
              <li
                key={d.name}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: d.color }}
                  />
                  <span className="truncate capitalize">{d.name}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {total > 0 ? Math.round((d.value / total) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
