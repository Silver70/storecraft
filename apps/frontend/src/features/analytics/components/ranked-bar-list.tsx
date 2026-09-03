import * as React from "react";
import { ChartCard, EmptyState } from "./chart-card";

export type RankedItem = {
  label: string;
  sublabel?: string;
  value: string;
  /** Raw magnitude used to size the bar (e.g. revenue in cents). */
  weight: number;
  /** Optional leading mark — a country flag, favicon, or product thumbnail. */
  icon?: React.ReactNode;
};

/**
 * Horizontal ranked bar list — labelled rows with a proportional bar. Reads
 * better than a bare bar chart for named rankings (top products, pages,
 * referrers) because each row keeps its label and formatted value inline.
 *
 * One hue, not eight: the job here is comparing magnitude, so colour carries no
 * identity. Every row states its value as text, which is also what lets this
 * component use the lower-contrast palette slots safely.
 */
export function RankedBarList({
  title,
  description,
  icon,
  action,
  items,
  emptyLabel = "No data for this period",
  emptyDetail,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  action?: React.ReactNode;
  items: RankedItem[];
  emptyLabel?: string;
  emptyDetail?: React.ReactNode;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.weight), 0);

  return (
    <ChartCard
      title={title}
      description={description}
      icon={icon}
      action={action}
    >
      {items.length === 0 ? (
        <EmptyState message={emptyLabel} detail={emptyDetail} />
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={`${item.label}-${i}`} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {item.icon ? (
                    <span className="flex shrink-0 items-center">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="truncate text-sm">{item.label}</span>
                  {item.sublabel ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.sublabel}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {item.value}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-1 transition-[width] duration-500 motion-reduce:transition-none"
                  style={{
                    width: `${max > 0 ? Math.max((item.weight / max) * 100, 2) : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
