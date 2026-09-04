import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CircleHelpIcon, MegaphoneIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type {
  AttributedRevenueReport,
  AttributionTouch,
  Period,
  RevenueBucket,
} from "~/types/api";
import { attributedRevenueQueryOptions } from "../queries";
import { formatPlatform } from "../utils";
import { CampaignStatusBadge } from "../components/campaign-status-badge";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const TOUCHES: { value: AttributionTouch; label: string; hint: string }[] = [
  {
    value: "last",
    label: "Last touch",
    hint: "Credits the campaign that closed the sale — the last tagged arrival before the order.",
  },
  {
    value: "first",
    label: "First touch",
    hint: "Credits the campaign that discovered the customer — the first tagged arrival before the order.",
  },
];

const COLUMNS = "grid-cols-[1fr_140px_120px_100px_130px]";

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** A magnitude bar sized against the period's largest line. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-chart-1 transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${max > 0 ? Math.max((value / max) * 100, 2) : 0}%` }}
      />
    </div>
  );
}

function Summary({
  totals,
  unattributed,
}: {
  totals: RevenueBucket;
  unattributed: RevenueBucket;
}) {
  const attributed = {
    orders: totals.orders - unattributed.orders,
    revenue: totals.revenue - unattributed.revenue,
  };
  const coverage = share(attributed.revenue, totals.revenue);

  const tiles = [
    {
      label: "Realized revenue",
      value: formatMoney(totals.revenue),
      hint: `${totals.orders.toLocaleString()} order${totals.orders === 1 ? "" : "s"}`,
    },
    {
      label: "Attributed to a campaign",
      value: formatMoney(attributed.revenue),
      hint: `${coverage.toFixed(0)}% of realized revenue`,
    },
    {
      label: "Unattributed",
      value: formatMoney(unattributed.revenue),
      hint: `${unattributed.orders.toLocaleString()} order${unattributed.orders === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} className="gap-0 p-5">
          <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{t.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
        </Card>
      ))}
    </div>
  );
}

export function CampaignRevenuePage() {
  const [period, setPeriod] = React.useState<Period>("30d");
  const [touch, setTouch] = React.useState<AttributionTouch>("last");

  const report: AttributedRevenueReport = useSuspenseQuery(
    attributedRevenueQueryOptions(period, touch),
  ).data;

  const max = Math.max(
    report.unattributed.revenue,
    ...report.campaigns.map((c) => c.revenue),
    0,
  );

  const touchHint = TOUCHES.find((t) => t.value === touch)!.hint;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 gap-1.5 text-muted-foreground"
          asChild
        >
          <Link to="/admin/campaigns">
            <ArrowLeftIcon className="h-4 w-4" />
            Campaigns
          </Link>
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Attributed revenue</h1>
            <p className="text-sm text-muted-foreground">
              Which campaigns produced sales, resolved from the tags each order
              carried when it was placed.
            </p>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              {PERIODS.map((p) => (
                <TabsTrigger key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <Summary totals={report.totals} unattributed={report.unattributed} />

      {/* ── Touch selector + lookback window ──────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={touch}
          onValueChange={(v) => setTouch(v as AttributionTouch)}
        >
          <TabsList>
            {TOUCHES.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* The window is why these figures differ from an ad platform's, so it
            is stated on screen rather than left for the merchant to infer. */}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleHelpIcon className="h-3.5 w-3.5 shrink-0" />
          <span>
            {report.lookbackDays}-day lookback window — a touch older than that
            gets no credit, so these numbers will not match an ad
            platform&apos;s.
          </span>
        </p>
      </div>

      <p className="text-xs text-muted-foreground">{touchHint}</p>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden gap-0 py-0">
        <div
          className={cn(
            "grid items-center border-b bg-muted/20 px-5 py-2.5 text-xs font-medium text-muted-foreground",
            COLUMNS,
          )}
        >
          <span>Campaign</span>
          <span>Platform</span>
          <span className="text-center">Status</span>
          <span className="text-right">Orders</span>
          <span className="text-right">Revenue</span>
        </div>

        {report.campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No campaigns yet. Create one and its orders will appear here.
            </p>
          </div>
        ) : (
          report.campaigns.map((line) => (
            <div
              key={line.campaignId}
              className={cn(
                "grid items-center border-b border-border/50 px-5 py-4 transition-colors hover:bg-muted/20",
                COLUMNS,
              )}
            >
              <div className="min-w-0 pr-4">
                <Link
                  to="/admin/campaigns/$campaignId"
                  params={{ campaignId: line.campaignId }}
                  className="truncate text-sm font-medium leading-none hover:underline"
                >
                  {line.name}
                </Link>
                <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {line.tag}
                </code>
                <Bar value={line.revenue} max={max} />
              </div>

              <span className="text-sm text-muted-foreground">
                {formatPlatform(line.platform)}
              </span>

              <div className="flex justify-center">
                <CampaignStatusBadge status={line.status} />
              </div>

              <span className="text-right text-sm tabular-nums">
                {line.orders.toLocaleString()}
              </span>

              <span className="text-right text-sm font-semibold tabular-nums">
                {formatMoney(line.revenue)}
              </span>
            </div>
          ))
        )}

        {/* Unattributed is a line of its own, below the campaigns and visually
            apart from them — never folded into one, which would flatter it. */}
        <div className={cn("grid items-center bg-muted/10 px-5 py-4", COLUMNS)}>
          <div className="min-w-0 pr-4">
            <p className="truncate text-sm font-medium leading-none">
              Unattributed
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              No qualifying touch — direct arrivals, untagged links, and touches
              outside the lookback window.
            </p>
            <Bar value={report.unattributed.revenue} max={max} />
          </div>
          <span />
          <span />
          <span className="text-right text-sm tabular-nums">
            {report.unattributed.orders.toLocaleString()}
          </span>
          <span className="text-right text-sm font-semibold tabular-nums">
            {formatMoney(report.unattributed.revenue)}
          </span>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Attribution is resolved every time this page loads, so a campaign
        created after its ads ran claims the orders they drove, and a matching
        rule added today repairs these figures rather than only affecting new
        orders. Revenue counts paid, processing, shipped and delivered orders —
        the same ones the dashboard and analytics report.
      </p>
    </div>
  );
}
