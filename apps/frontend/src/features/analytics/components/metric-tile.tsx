import * as React from "react";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export type SubStat = { label: string; value: string };

/**
 * The analytics metric tile: eyebrow label, hero figure, and optional supporting
 * detail — a delta against the prior period, a sparkline, and nested sub-stats.
 *
 * `delta`, `sparkline`, and `subStats` are all optional so the tile can carry a
 * bare number today and grow a comparison later without a second component; the
 * analytics endpoints don't return prior-period figures yet (P3).
 *
 * Delta colour is a reserved status hue and always ships with an arrow icon, so
 * direction is never carried by colour alone.
 */
export function MetricTile({
  label,
  value,
  hint,
  delta,
  deltaLabel = "vs prior period",
  sparkline,
  subStats,
  icon: Icon,
  size = "default",
  /** Higher is better for most metrics; set false for things like refund rate. */
  higherIsBetter = true,
  status,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number;
  deltaLabel?: string;
  sparkline?: React.ReactNode;
  subStats?: SubStat[];
  icon?: React.ElementType;
  size?: "default" | "hero";
  higherIsBetter?: boolean;
  /**
   * Flags a metric that needs attention (stock out, refunds present). Renders a
   * dot beside the label rather than tinting the figure — the label already
   * names the condition, so colour never carries the meaning on its own.
   */
  status?: "good" | "warning" | "critical";
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const rising = hasDelta && delta > 0;
  const flat = hasDelta && delta === 0;
  const good = flat ? null : rising === higherIsBetter;

  return (
    <Card className="overflow-hidden">
      <CardContent className={cn("p-5", size === "hero" && "p-6")}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {status ? (
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  status === "good" && "bg-status-good",
                  status === "warning" && "bg-status-warning",
                  status === "critical" && "bg-status-critical",
                )}
                aria-hidden="true"
              />
            ) : Icon ? (
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            <span className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>

          {hasDelta ? (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                good === null && "bg-muted text-muted-foreground",
                good === true && "bg-status-good/12 text-status-good",
                good === false && "bg-status-critical/12 text-status-critical",
              )}
              title={`${delta > 0 ? "+" : ""}${delta}% ${deltaLabel}`}
            >
              {rising ? (
                <TrendingUpIcon className="h-3 w-3" aria-hidden="true" />
              ) : flat ? null : (
                <TrendingDownIcon className="h-3 w-3" aria-hidden="true" />
              )}
              {Math.abs(delta)}%
            </span>
          ) : null}
        </div>

        <p
          className={cn(
            "font-bold leading-none tracking-tight",
            size === "hero" ? "text-[2.5rem]" : "text-2xl",
          )}
        >
          {value}
        </p>

        {hint ? (
          <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
        ) : null}

        {sparkline ? <div className="mt-3 h-10">{sparkline}</div> : null}

        {subStats?.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
            {subStats.map((s) => (
              <div key={s.label} className="min-w-0">
                <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
