import { useQuery } from "@tanstack/react-query";
import { CircleHelpIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { formatMoney } from "~/lib/money";
import { cn } from "~/lib/utils";
import type {
  AttributionTouch,
  CampaignRevenueLine,
  Period,
} from "~/types/api";
import { attributedRevenueQueryOptions } from "../queries";
import {
  AttributionTouchTabs,
  attributionTouchHint,
} from "./campaign-performance-controls";

function formatRoas(roas: number | null): string {
  return roas === null ? "—" : `${roas.toFixed(2)}×`;
}

/** A `YYYY-MM-DD` in the store's timezone, shown as a day rather than an instant. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
  tone?: "loss" | "absent";
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "loss" && "text-destructive",
            tone === "absent" && "text-muted-foreground",
          )}
        >
          {value}
        </p>
        <CardDescription>{hint}</CardDescription>
      </CardContent>
    </Card>
  );
}

function LoadingFigures() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {["spend", "roas", "margin"].map((label) => (
        <Card key={label} size="sm">
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function marginHint(line: CampaignRevenueLine, currency?: string): string {
  if (line.contributionMargin === null) {
    return `${formatMoney(line.goodsRevenue, currency)} of goods, none costed`;
  }
  if (line.goodsRevenue === 0) {
    return line.spend > 0
      ? "Spend only, no sales"
      : "No goods revenue this period";
  }
  return `${line.costCoveragePct}% of goods revenue costed`;
}

function LoadedFigures({
  line,
  currency,
  spendFrom,
  spendTo,
}: {
  line: CampaignRevenueLine;
  currency?: string;
  spendFrom: string;
  spendTo: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Figure
        label="Spend"
        value={formatMoney(line.spend, currency)}
        hint={`Recorded ${formatDay(spendFrom)} – ${formatDay(spendTo)}`}
      />
      <Figure
        label="ROAS"
        value={formatRoas(line.roas)}
        hint={
          line.roas === null
            ? "Nothing spent, so nothing to divide"
            : `${formatMoney(line.revenue, currency)} attributed revenue over spend`
        }
        tone={line.roas === null ? "absent" : undefined}
      />
      <Figure
        label="Contribution margin"
        value={
          line.contributionMargin === null
            ? "No cost data"
            : formatMoney(line.contributionMargin, currency)
        }
        hint={marginHint(line, currency)}
        tone={
          line.contributionMargin === null
            ? "absent"
            : line.contributionMargin < 0
              ? "loss"
              : undefined
        }
      />
    </div>
  );
}

/**
 * The report reduced to the Campaign whose detail page is open.
 *
 * This deliberately uses `attributedRevenueQueryOptions` and selects a line
 * from the returned report. Spend, ROAS, margin, coverage, the period boundary,
 * and the Lookback Window therefore come from the exact read behind the table;
 * none of them are recalculated for this panel.
 */
export function CampaignPerformancePanel({
  campaignId,
  period,
  touch,
  currency,
  onTouchChange,
}: {
  campaignId: string;
  period: Period;
  touch: AttributionTouch;
  currency?: string;
  onTouchChange: (touch: AttributionTouch) => void;
}) {
  const {
    data: report,
    isPending,
    isError,
    refetch,
  } = useQuery(attributedRevenueQueryOptions(period, touch));
  const line = report?.campaigns.find(
    (campaign) => campaign.campaignId === campaignId,
  );

  return (
    <section
      aria-labelledby="campaign-performance-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="campaign-performance-title" className="font-medium">
            Return for this campaign
          </h3>
          <p className="text-xs text-muted-foreground">
            The same figures shown for this campaign in the full performance
            report.
          </p>
        </div>
        <AttributionTouchTabs value={touch} onValueChange={onTouchChange} />
      </div>

      {isPending ? (
        <LoadingFigures />
      ) : isError ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Performance could not be loaded for this period.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : line ? (
        <LoadedFigures
          line={line}
          currency={currency}
          spendFrom={report.spendFrom}
          spendTo={report.spendTo}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          This archived campaign has no spend or attributed sales in the
          selected period.
        </p>
      )}

      {report && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CircleHelpIcon className="mt-0.5 size-3.5 shrink-0" />
          <p>
            {report.lookbackDays}-day lookback window.{" "}
            {attributionTouchHint(touch)}
          </p>
        </div>
      )}
    </section>
  );
}
