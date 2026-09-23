import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import type { PerformanceFigures } from "~/types/api";

/**
 * The two figures every line of this page carries, said the same way at every
 * grain — a campaign, one of its ads, or the unassigned residue between them.
 *
 * One component rather than one per card, so a campaign and the ads beneath it
 * cannot come to present the same number differently.
 *
 * **There is no cost side any more.** Spend was typed in by hand, and ROAS and
 * contribution margin were arithmetic on top of it — all three were only ever as
 * current as the last day a merchant remembered to enter. They come back when
 * the ad platform reports what it charged. Nothing stands in for them in the
 * meantime: a `$0.00` spend would be a claim, and it would be false.
 *
 * The lookback window rides under the revenue rather than in a legend. It is
 * the reason this figure differs from the ad platform's, and a merchant reading
 * the number will not go looking for it.
 */
export function FigureList({
  line,
  lookbackDays,
  layout = "stack",
  className,
}: {
  line: PerformanceFigures;
  lookbackDays: number;
  /** `row` for a campaign header, `stack` for a card in the grid. */
  layout?: "row" | "stack";
  className?: string;
}) {
  const figures: { label: string; value: string; caveat?: string }[] = [
    {
      label: "Revenue",
      value: formatMoney(line.revenue),
      caveat: `${lookbackDays}-day window`,
    },
    { label: "Purchases", value: line.orders.toLocaleString() },
  ];

  return (
    <dl
      className={cn(
        layout === "row" ? "grid grid-cols-2 gap-x-6 gap-y-4" : "space-y-2",
        className,
      )}
    >
      {figures.map((figure) => (
        <div
          key={figure.label}
          className={cn(
            layout === "row"
              ? "min-w-0"
              : "flex items-baseline justify-between gap-3",
          )}
        >
          <dt
            className={cn(
              "text-xs text-muted-foreground",
              layout === "row" && "font-medium",
            )}
          >
            {figure.label}
          </dt>
          <dd className={cn(layout === "row" ? "mt-1" : "min-w-0 text-right")}>
            <span
              className={cn(
                "font-semibold tabular-nums",
                layout === "row" ? "text-lg" : "text-sm",
              )}
            >
              {figure.value}
            </span>
            {figure.caveat && (
              <span className="block text-[11px] leading-tight text-muted-foreground/70">
                {figure.caveat}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
