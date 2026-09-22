import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { AreaChart } from "~/components/charts/area-chart";
import { Area } from "~/components/charts/area";
import { Grid } from "~/components/charts/grid";
import { XAxis } from "~/components/charts/x-axis";
import { YAxis } from "~/components/charts/y-axis";
import { ChartTooltip } from "~/components/charts/tooltip";
import { fmt } from "../utils";

/**
 * Axis ticks want whole dollars. `fmt` keeps two decimals below $1k, which
 * stacks up as "$800.00 / $600.00 / $400.00" down the axis and reads as noise
 * next to the compacted "$1.2k" above it. The tooltip still uses `fmt` — cents
 * are worth showing for the one value you are pointing at.
 */
const axisMoney = (cents: number) => {
  const n = cents / 100;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
};

/**
 * Revenue over the selected period.
 *
 * First chart moved off Recharts onto the bklit/visx components. Two things
 * differ from the rest of the dashboard as a result, and both are deliberate:
 * the axis and tooltip labels are derived from the `Date` values rather than
 * passed in pre-formatted, and the chart paints on hydration instead of
 * server-rendering, because visx measures the container before it can draw.
 *
 * The page fetches with `useSuspenseQuery`, so there is no loading state to
 * pass down here; if the hydration gap ever reads as a flash, `AreaChart` takes
 * a `status="loading"` prop that draws a skeleton to cover it.
 */
export function RevenueTrend({
  data,
}: {
  data: { date: Date; revenue: number }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Revenue</CardTitle>
            <CardDescription className="text-xs">
              Current period trend
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-chart-1" />
            This period
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <AreaChart
          data={data}
          xDataKey="date"
          /* Left margin carries the currency ticks. The bottom has to clear the
             date row outright: XAxis portals its labels over the container at a
             fixed offset rather than reserving space, so too small a value here
             lands them on top of the lowest Y tick. */
          margin={{ top: 8, right: 16, bottom: 40, left: 48 }}
          /* Pin the old h-64 instead of the default 2:1 aspect ratio, so the
             card keeps its height as the dashboard column width changes. */
          style={{ height: 256, aspectRatio: "auto" }}
        >
          <Grid horizontal />
          <YAxis formatValue={axisMoney} numTicks={5} />
          <Area
            dataKey="revenue"
            fill="var(--chart-1)"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fillOpacity={0.25}
          />
          <XAxis />
          <ChartTooltip
            rows={(point) => [
              {
                color: "var(--chart-1)",
                label: "Revenue",
                value: fmt(point.revenue as number),
              },
            ]}
          />
        </AreaChart>
      </CardContent>
    </Card>
  );
}
