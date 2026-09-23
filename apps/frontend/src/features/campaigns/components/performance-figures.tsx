import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import type { RevenueBucket } from "~/types/api";

/**
 * The two figures every line of this page carries, said the same way at every
 * grain — a campaign, one of its ads, or the revenue that named no ad.
 *
 * One component rather than one per card, so a campaign and the ads beneath it
 * cannot come to present the same number differently.
 *
 * **Not Tracked is not zero.** When `tracked` is false the ads carry no Link
 * Tags, so no order could name them: the revenue is unknown, and it is shown as
 * a dash and the words "Not tracked" rather than as `$0.00`, which would invent
 * a failure that did not happen.
 *
 * The lookback window rides under the revenue rather than in a legend. It is
 * one reason this figure differs from the ad platform's.
 */
export function FigureList({
  line,
  lookbackDays,
  tracked = true,
  layout = "stack",
  className,
}: {
  line: RevenueBucket;
  lookbackDays: number;
  /** False for a Not Tracked campaign or ad. Defaults to tracked. */
  tracked?: boolean;
  /** `row` for a campaign header, `stack` for a card in the grid. */
  layout?: "row" | "stack";
  className?: string;
}) {
  const figures: { label: string; value: string; caveat?: string }[] = tracked
    ? [
        {
          label: "Revenue",
          value: formatMoney(line.revenue),
          caveat: `${lookbackDays}-day window`,
        },
        { label: "Purchases", value: line.orders.toLocaleString() },
      ]
    : [
        { label: "Revenue", value: "—", caveat: "Not tracked" },
        { label: "Purchases", value: "—", caveat: "Not tracked" },
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
