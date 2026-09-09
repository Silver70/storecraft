import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import type { PerformanceFigures } from "~/types/api";
import { coverageNote, formatRoas } from "../utils";

/**
 * The five figures every line of this page carries, said the same way at every
 * grain — a campaign, one of its ads, or the unassigned residue between them.
 *
 * One component rather than one per card, because the null states are the
 * substance and they must not drift: no ROAS without spend rather than a zero
 * that ranks an organic push as a failure, no margin without cost coverage
 * rather than a fiction built on missing cost prices, and a loss shown with its
 * sign and its colour rather than left to be read past.
 *
 * Two figures carry their caveat immediately beneath them rather than in a
 * legend. The lookback window is why a ROAS here differs from the ad
 * platform's, and cost coverage is what separates a margin from a guess; a
 * merchant reading the number will not go looking for either.
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
  const note = coverageNote(line);
  const partiallyCosted = line.goodsRevenue > 0 && line.costCoveragePct < 100;

  const figures: {
    label: string;
    value: string;
    caveat?: string;
    tone?: "loss" | "absent" | "warn";
  }[] = [
    { label: "Revenue", value: formatMoney(line.revenue) },
    { label: "Purchases", value: line.orders.toLocaleString() },
    {
      // An em dash rather than $0.00: no spend was recorded, which is a
      // different statement from a day that cost nothing.
      label: "Spend",
      value: line.spend > 0 ? formatMoney(line.spend) : "—",
      tone: line.spend > 0 ? undefined : "absent",
    },
    {
      label: "ROAS",
      value: formatRoas(line.roas),
      // Shown next to every ROAS on the page and not once at the top: it is the
      // reason this figure and the ad platform's disagree, and the comparison
      // is made card by card.
      caveat:
        line.roas === null ? "nothing spent" : `${lookbackDays}-day window`,
      tone: line.roas === null ? "absent" : undefined,
    },
    line.contributionMargin === null
      ? {
          label: "Margin",
          // Never a dash and never a zero. A dash would read as "nothing here",
          // a zero as "broke even"; what happened is that goods sold and none
          // of them have a cost price, which is a thing a merchant can fix.
          value: "No cost data",
          caveat: `${formatMoney(line.goodsRevenue)} of goods, none costed`,
          tone: "absent" as const,
        }
      : {
          label: "Margin",
          value: formatMoney(line.contributionMargin),
          caveat: note ?? undefined,
          tone: line.contributionMargin < 0 ? ("loss" as const) : undefined,
        },
  ];

  return (
    <dl
      className={cn(
        layout === "row"
          ? "grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5"
          : "space-y-2",
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
                figure.tone === "loss" && "text-destructive",
                figure.tone === "absent" && "font-normal text-muted-foreground",
              )}
            >
              {figure.value}
            </span>
            {figure.caveat && (
              <span
                className={cn(
                  "block text-[11px] leading-tight",
                  // Partial coverage qualifies the number above it — it is the
                  // difference between a margin and a guess, so it is not
                  // whispered at the same weight as the rest.
                  figure.label === "Margin" && partiallyCosted
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-muted-foreground/70",
                )}
              >
                {figure.caveat}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
