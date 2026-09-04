import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CircleAlertIcon,
  MegaphoneIcon,
  TrendingUpIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import type { MarketingSummary, Period } from "~/types/api";
import { marketingSummaryQueryOptions } from "~/features/campaigns/queries";

/**
 * ROAS as the ratio it is — `4.25×` is $4.25 back per dollar spent. Never
 * passed through the money formatter, which would turn a ratio into an amount.
 *
 * A null is an em dash rather than a zero: nothing was spent, so there is no
 * return on spend, and `0.00×` would read as an account that failed.
 */
function formatRoas(roas: number | null): string {
  return roas === null ? "—" : `${roas.toFixed(2)}×`;
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "muted";
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums leading-none",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Shell({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="shrink-0 rounded-md bg-muted p-1.5">
              <MegaphoneIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              Ad spend
            </span>
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The way out of a bad number. Present in every state of the card, including
 * the empty one — the report is where a figure on this card is explained, and
 * it should never be more than one click from the figure that raised the
 * question.
 */
function ReportLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mr-2 -mt-1 h-7 shrink-0 gap-1 text-xs text-muted-foreground"
      asChild
    >
      <Link to="/admin/campaigns/revenue">
        Full report
        <ArrowRightIcon className="h-3 w-3" />
      </Link>
    </Button>
  );
}

function Loaded({ summary }: { summary: MarketingSummary }) {
  // Never recorded a cost anywhere, ever — which is not the same as a period
  // that cost nothing, and gets different words. A $0.00 here would read as a
  // broken card to a merchant who has simply not set this up yet, and it is the
  // one state where the useful thing to show is an invitation rather than a
  // figure.
  if (!summary.spendEverRecorded) {
    return (
      <Shell action={<ReportLink />}>
        <p className="text-sm font-medium">No ad spend recorded yet</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Record what a campaign cost and this card shows what came back for it
          — spend, attributed revenue, and the return between the two.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-8 gap-1.5"
          asChild
        >
          <Link to="/admin/campaigns">
            <MegaphoneIcon className="h-3.5 w-3.5" />
            Record spend
          </Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell action={<ReportLink />}>
      <div className="grid gap-5 sm:grid-cols-3">
        <Figure
          label="Spend"
          value={formatMoney(summary.spend)}
          hint={
            summary.spend > 0
              ? "Recorded against campaigns this period"
              : "Nothing recorded for this period"
          }
        />
        <Figure
          label="Attributed revenue"
          value={formatMoney(summary.revenue)}
          hint="Orders a campaign explains"
        />
        <Figure
          label="Blended ROAS"
          value={formatRoas(summary.roas)}
          // Summed then divided across the whole account, never an average of
          // per-campaign ratios — a $5 campaign with one lucky sale must not
          // outweigh a $5,000 one.
          hint={
            summary.roas === null
              ? "Nothing spent, so nothing to divide"
              : "Attributed revenue over spend"
          }
          tone={summary.roas === null ? "muted" : undefined}
        />
      </div>

      {/* The two caveats that keep the ratio above from being read as more than
          it is. Unattributed says how much revenue these figures ignore, and
          the lookback window says why they will not match an ad platform's. */}
      <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
        <TrendingUpIcon className="mr-1.5 inline h-3 w-3 align-[-1px]" />
        {formatMoney(summary.unattributedRevenue)} of revenue —{" "}
        {summary.unattributedPct}% of the period&apos;s total — has no campaign
        behind it and is not in these figures. {summary.lookbackDays}-day
        lookback window.
      </p>
    </Shell>
  );
}

/**
 * What was spent this period, what came back, and the ratio between them —
 * on the page a merchant opens first.
 *
 * **Its own request, deliberately outside the dashboard's loader.** The
 * dashboard module knows nothing about campaigns on the backend: marketing
 * publishes a summary read and this card composes it in, which is where the
 * coupling between two report modules is cheapest. The price of that is a
 * second request that can fail on its own, and the rule is that it must fail on
 * its own — `useQuery` rather than `useSuspenseQuery`, so a marketing outage
 * renders one errored card instead of throwing to the boundary and taking the
 * revenue, orders and conversion figures down with it.
 *
 * Every number here is read off the campaign performance report on the backend,
 * so the "Full report" link leads to the same figures rather than to a second
 * opinion.
 */
export function SpendSummary({ period }: { period: Period }) {
  const { data, isPending, isError } = useQuery(
    marketingSummaryQueryOptions(period),
  );

  if (isPending) {
    return (
      <Shell>
        <div className="grid gap-5 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-6 w-28" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  // Said plainly and kept small. The merchant came to this page for the figures
  // around this card, and one report being unavailable is a footnote on their
  // morning rather than an error state worth shouting about.
  if (isError) {
    return (
      <Shell action={<ReportLink />}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleAlertIcon className="h-4 w-4 shrink-0" />
          Spend and ROAS could not be loaded for this period.
        </p>
      </Shell>
    );
  }

  return <Loaded summary={data} />;
}
