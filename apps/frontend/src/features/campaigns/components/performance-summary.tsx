import { CalendarClockIcon, CircleHelpIcon, ScaleIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Card } from "~/components/ui/card";
import type { AttributedRevenueReport } from "~/types/api";
import { formatDay, formatRoas } from "../utils";

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * The account as a whole, above the campaigns it is the sum of.
 *
 * Every tile is a field of the report or a share of two of them — nothing here
 * is computed a second way, so the header and the cards beneath it cannot
 * disagree about what the period cost.
 */
export function PerformanceSummary({
  report,
}: {
  report: AttributedRevenueReport;
}) {
  const { blended, totals, unattributed } = report;
  const attributedOrders = totals.orders - unattributed.orders;
  // The share of realized revenue that has a campaign behind it. Named apart
  // from cost coverage, which is a different share of a different total and
  // also lives on this page.
  const attributedShare = share(blended.revenue, totals.revenue);

  const tiles: {
    label: string;
    value: string;
    hint: string;
    /** `absent` is a phrase where a figure would be, not a figure. */
    tone?: "loss" | "absent";
  }[] = [
    {
      label: "Spend",
      value: formatMoney(blended.spend),
      hint:
        blended.spend > 0
          ? `Recorded ${formatDay(report.spendFrom)} – ${formatDay(report.spendTo)}`
          : "No spend recorded for this period",
    },
    {
      label: "Attributed revenue",
      value: formatMoney(blended.revenue),
      hint: `${attributedOrders.toLocaleString()} purchase${attributedOrders === 1 ? "" : "s"} · ${attributedShare.toFixed(0)}% of realized revenue`,
    },
    {
      label: "Blended ROAS",
      value: formatRoas(blended.roas),
      // Summed and then divided, never an average of the per-campaign ratios —
      // a $5 campaign with one lucky sale must not outweigh a $5,000 one.
      hint:
        blended.roas === null
          ? "Nothing spent, so nothing to divide"
          : `Attributed revenue over spend, across every campaign · ${report.lookbackDays}-day window`,
    },
    {
      label: "Contribution margin",
      // The figure that answers "keep spending?", where ROAS only answers "how
      // much came back". Built on goods, never on the order total — see the
      // basis note beneath the tiles.
      value:
        blended.contributionMargin === null
          ? "No cost data"
          : formatMoney(blended.contributionMargin),
      hint:
        blended.contributionMargin === null
          ? "No variant sold in this period has a cost price yet"
          : `Goods less discounts, cost of goods and spend · ${blended.costCoveragePct}% of goods revenue costed`,
      // An account losing money says so in the colour as well as the sign — a
      // leading minus is easy to read past on a screen of black figures.
      tone:
        blended.contributionMargin === null
          ? ("absent" as const)
          : blended.contributionMargin < 0
            ? ("loss" as const)
            : undefined,
    },
    {
      label: "Realized revenue",
      value: formatMoney(totals.revenue),
      hint: `${totals.orders.toLocaleString()} purchase${totals.orders === 1 ? "" : "s"}, attributed or not`,
    },
    {
      label: "Unattributed",
      value: formatMoney(unattributed.revenue),
      hint: `${unattributed.orders.toLocaleString()} purchase${unattributed.orders === 1 ? "" : "s"} · no spend, no ROAS`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} className="gap-0 p-5">
          <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
          <p
            className={cn(
              "mt-2 font-semibold tabular-nums",
              t.tone === "absent"
                ? "text-lg text-muted-foreground"
                : "text-2xl",
              t.tone === "loss" && "text-destructive",
            )}
          >
            {t.value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * Which revenue each figure is a share of.
 *
 * Two bases, both correct, and not the same number. Leaving a merchant to
 * discover on their own that ROAS and contribution margin do not reconcile is
 * how a report loses their trust for good.
 */
export function RevenueBasisNote() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      <ScaleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <span className="font-medium text-foreground">Two revenue bases.</span>{" "}
        <span className="font-medium text-foreground">ROAS</span> divides the{" "}
        <span className="font-medium text-foreground">order total</span> — tax
        and shipping included, discounts already taken off — which is the
        revenue shown on every card and row here.{" "}
        <span className="font-medium text-foreground">Contribution margin</span>{" "}
        is built on the{" "}
        <span className="font-medium text-foreground">goods basis</span>: line
        totals before discount, less discounts, cost of goods and spend. Tax is
        collected and remitted and is never profit, and shipping is left out of
        both sides because shipping cost is not tracked here — so the two
        figures differ, and both are right.
      </p>
    </div>
  );
}

/** The two caveats that qualify every figure on this page. */
export function PerformanceCaveats({ lookbackDays }: { lookbackDays: number }) {
  return (
    <div className="space-y-1.5 sm:max-w-md">
      {/* The window is why these figures differ from an ad platform's, so it is
          stated on screen rather than left for the merchant to infer. */}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CircleHelpIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {lookbackDays}-day lookback window — a touch older than that gets no
          credit, so these numbers will not match an ad platform&apos;s.
        </span>
      </p>
      {/* Spend is day-grained and revenue is not. Read at 9am, today's ROAS
          divides a whole day of cost into part of a day of sales, and looks
          like a collapse that has not happened. */}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CalendarClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Spend is recorded per whole day and revenue to the second, so a ROAS
          read part-way through today compares a full day of cost against a
          partial day of sales.
        </span>
      </p>
    </div>
  );
}
