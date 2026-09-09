import { ActivityIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { MeasuredTraffic } from "~/types/api";

/**
 * Who a campaign or a creative was *seen* by, and what share of them bought.
 *
 * Deliberately its own component and never a sixth entry in `FigureList`. The
 * figures beside it are derived from orders — money that changed hands, kept
 * forever. These two come from the tracked event stream, which an ad blocker
 * can suppress outright, which an integrator may never have embedded, and which
 * the retention purge deletes on a schedule. Drawn in the same typography they
 * would claim to be equally solid, and they are not: when ad blockers eat a
 * third of the traffic the denominator is a third too small, the conversion
 * rate reads far higher than it is, and a merchant optimises toward a fiction.
 *
 * So the separation is structural rather than a matter of restraint. The
 * backend nests the pair in its own object; this component is the only thing
 * that renders it, and it renders it smaller, lighter, behind a dashed rule and
 * under a label naming what it is. Adding one of these figures to the list
 * above would take a deliberate act, which is the point.
 *
 * The demotion follows the convention this page already uses for a qualified
 * number — cost coverage beneath contribution margin, the lookback window
 * beneath ROAS — and for the same reason: the caveat sits against the figure it
 * qualifies, because nobody goes looking for a legend.
 */
export function MeasuredPair({
  measured,
  /** `row` beside a campaign's figures, `stack` on a card in the grid. */
  layout = "stack",
  className,
}: {
  measured: MeasuredTraffic | null;
  layout?: "row" | "stack";
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Dashed, because the rule between these figures and the ones above is
        // exactly the point being made.
        "border-t border-dashed pt-2.5",
        className,
      )}
    >
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <ActivityIcon className="h-3 w-3" aria-hidden />
        Measured
      </p>

      {measured === null ? (
        // Absent, not zero. A zero would say nobody came; what happened is that
        // nobody was seen, and on a store with no tracker embedded — or a
        // period the retention purge has already reached — that is every line
        // on this page.
        <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground/70">
          No tracked visits in this period. Not the same as no visitors.
        </p>
      ) : (
        <>
          <dl
            className={cn(
              "mt-1.5",
              layout === "row" ? "flex flex-wrap gap-x-8 gap-y-1" : "space-y-1",
            )}
          >
            <Figure
              label="Visitors"
              value={measured.visitors.toLocaleString()}
              layout={layout}
            />
            <Figure
              label="Conversion rate"
              // One decimal, because a real rate lives between 0.5% and 4% and
              // whole numbers would round a genuine 0.4% to nothing.
              value={`${measured.conversionRatePct.toFixed(1)}%`}
              layout={layout}
            />
          </dl>

          <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground/70">
            Tracked visits only — ad blockers undercount them, so this rate
            reads high.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * One measured figure. Lighter and smaller than anything in `FigureList` — the
 * weight of the type is the claim being made about the number.
 */
function Figure({
  label,
  value,
  layout,
}: {
  label: string;
  value: string;
  layout: "row" | "stack";
}) {
  return (
    <div
      className={cn(
        layout === "row"
          ? "flex items-baseline gap-2"
          : "flex items-baseline justify-between gap-3",
      )}
    >
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-xs tabular-nums text-muted-foreground">{value}</dd>
    </div>
  );
}
