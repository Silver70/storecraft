import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CircleHelpIcon,
  MegaphoneIcon,
  ScaleIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type {
  AttributedRevenueReport,
  AttributionTouch,
  CampaignRevenueLine,
  Period,
} from "~/types/api";
import { attributedRevenueQueryOptions } from "../queries";
import { formatPlatform } from "../utils";
import { CampaignStatusBadge } from "../components/campaign-status-badge";
import {
  AttributionTouchTabs,
  PerformancePeriodTabs,
  attributionTouchHint,
} from "../components/campaign-performance-controls";

const COLUMNS =
  "grid-cols-[minmax(180px,1fr)_110px_104px_76px_112px_124px_88px_150px]";

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * ROAS as a ratio, which is what it is — `4.25×` means $4.25 back for every
 * dollar spent. It is deliberately never passed through the money formatter:
 * this is the one figure on the page that is not an amount.
 *
 * A null is an em dash, not a zero. Nothing was spent, so there is no return on
 * spend to report, and a `0.00×` would read as a campaign that failed.
 */
function formatRoas(roas: number | null): string {
  return roas === null ? "—" : `${roas.toFixed(2)}×`;
}

/**
 * The cost coverage behind a margin, said in words rather than left as a bare
 * percentage.
 *
 * Coverage is the caveat on the number beside it, so it is never far from it:
 * at 60% the margin understates cost and therefore overstates itself, and a
 * merchant who cannot see that will read a half-costed catalog as a healthy
 * one. Zero goods revenue is not low coverage — there was nothing to cost — so
 * it says what actually happened instead of reporting 0%.
 */
function coverageNote(line: {
  goodsRevenue: number;
  costCoveragePct: number;
  spend: number;
}): string | null {
  if (line.goodsRevenue > 0) {
    return line.costCoveragePct === 100
      ? "fully costed"
      : `${line.costCoveragePct}% costed`;
  }
  return line.spend > 0 ? "spend only, no sales" : null;
}

/** A `YYYY-MM-DD` in the store's timezone, shown as a day and not an instant. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

/**
 * Contribution margin, with the coverage that qualifies it directly beneath.
 *
 * The two are one cell rather than two columns on purpose: a margin read
 * without its coverage is the failure mode this whole ticket guards against,
 * and a merchant scanning a table will not look two columns away for the
 * caveat on the number they are looking at.
 *
 * A null margin is an explicit "No cost data", never a dash and never a zero.
 * A dash would read as "nothing here"; a zero would read as "broke even". What
 * actually happened is that goods were sold and none of them have a cost price,
 * which is a thing the merchant can go and fix.
 */
function MarginCell({ line }: { line: CampaignRevenueLine }) {
  const note = coverageNote(line);

  if (line.contributionMargin === null) {
    return (
      <div className="text-right">
        <span className="text-sm text-muted-foreground">No cost data</span>
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground/70">
          {formatMoney(line.goodsRevenue)} of goods, none costed
        </p>
      </div>
    );
  }

  return (
    <div className="text-right">
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          line.contributionMargin < 0 && "text-destructive",
        )}
      >
        {formatMoney(line.contributionMargin)}
      </span>
      {note && (
        <p
          className={cn(
            "mt-0.5 text-[11px] leading-tight",
            // Partial coverage is a qualification on the number above it, not a
            // footnote — it is the difference between a margin and a guess.
            line.goodsRevenue > 0 && line.costCoveragePct < 100
              ? "text-amber-600 dark:text-amber-500"
              : "text-muted-foreground/70",
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function Summary({ report }: { report: AttributedRevenueReport }) {
  const { blended, totals, unattributed } = report;
  const attributedOrders = totals.orders - unattributed.orders;
  // The share of realized revenue that has a campaign behind it. Named apart
  // from cost coverage, which is a different share of a different total and now
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
      hint: `${attributedOrders.toLocaleString()} order${attributedOrders === 1 ? "" : "s"} · ${attributedShare.toFixed(0)}% of realized revenue`,
    },
    {
      label: "Blended ROAS",
      value: formatRoas(blended.roas),
      // Summed and then divided, never an average of the per-campaign ratios —
      // a $5 campaign with one lucky sale must not outweigh a $5,000 one.
      hint:
        blended.roas === null
          ? "Nothing spent, so nothing to divide"
          : "Attributed revenue over spend, across every campaign",
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
      hint: `${totals.orders.toLocaleString()} order${totals.orders === 1 ? "" : "s"}, attributed or not`,
    },
    {
      label: "Unattributed",
      value: formatMoney(unattributed.revenue),
      hint: `${unattributed.orders.toLocaleString()} order${unattributed.orders === 1 ? "" : "s"} · no spend, no ROAS`,
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

  const touchHint = attributionTouchHint(touch);

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
            <h1 className="text-2xl font-semibold">Campaign performance</h1>
            <p className="text-sm text-muted-foreground">
              What each campaign cost, what it produced, and the return between
              the two — resolved from the tags each order carried when it was
              placed.
            </p>
          </div>
          <PerformancePeriodTabs value={period} onValueChange={setPeriod} />
        </div>
      </div>

      <Summary report={report} />

      {/* ── Which revenue each figure above is a share of ─────────────────────── */}
      {/* Two bases, both correct, and not the same number. Leaving a merchant to
          discover on their own that ROAS and contribution margin do not
          reconcile is how a report loses their trust for good. */}
      <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <ScaleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          <span className="font-medium text-foreground">
            Two revenue bases.
          </span>{" "}
          <span className="font-medium text-foreground">ROAS</span> divides the{" "}
          <span className="font-medium text-foreground">order total</span> — tax
          and shipping included, discounts already taken off — which is the
          revenue shown in the table.{" "}
          <span className="font-medium text-foreground">
            Contribution margin
          </span>{" "}
          is built on the{" "}
          <span className="font-medium text-foreground">goods basis</span>: line
          totals before discount, less discounts, cost of goods and spend. Tax
          is collected and remitted and is never profit, and shipping is left
          out of both sides because shipping cost is not tracked here — so the
          two figures differ, and both are right.
        </p>
      </div>

      {/* ── Touch selector + the two caveats on every figure here ─────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <AttributionTouchTabs value={touch} onValueChange={setTouch} />

        <div className="space-y-1.5 sm:max-w-md">
          {/* The window is why these figures differ from an ad platform's, so it
              is stated on screen rather than left for the merchant to infer. */}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CircleHelpIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {report.lookbackDays}-day lookback window — a touch older than
              that gets no credit, so these numbers will not match an ad
              platform&apos;s.
            </span>
          </p>
          {/* Spend is day-grained and revenue is not. Read at 9am, today's ROAS
              divides a whole day of cost into part of a day of sales, and looks
              like a collapse that has not happened. */}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Spend is recorded per whole day and revenue to the second, so a
              ROAS read part-way through today compares a full day of cost
              against a partial day of sales.
            </span>
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{touchHint}</p>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden gap-0 py-0">
        <div className="overflow-x-auto">
          <div className="min-w-260">
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
              <span className="text-right">Spend</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">ROAS</span>
              <span className="text-right">Contribution margin</span>
            </div>

            {report.campaigns.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No campaigns yet. Create one and its orders will appear here.
                </p>
              </div>
            ) : (
              report.campaigns.map((line) => {
                // Money out and nothing back. The row this report exists to
                // show, so it is tinted rather than merely present — a campaign
                // that is quietly burning budget should not read like one that
                // was never funded.
                const burning = line.spend > 0 && line.revenue === 0;

                return (
                  <div
                    key={line.campaignId}
                    className={cn(
                      "grid items-center border-b border-border/50 px-5 py-4 transition-colors",
                      COLUMNS,
                      burning
                        ? "bg-destructive/5 hover:bg-destructive/10"
                        : "hover:bg-muted/20",
                    )}
                  >
                    <div className="min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <Link
                          to="/admin/campaigns/$campaignId"
                          params={{ campaignId: line.campaignId }}
                          className="truncate text-sm font-medium leading-none hover:underline"
                        >
                          {line.name}
                        </Link>
                        {burning && (
                          <span className="shrink-0 rounded-full border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive">
                            No revenue
                          </span>
                        )}
                      </div>
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

                    {/* An em dash rather than $0.00: no spend was recorded, which
                        is a different statement from a day that cost nothing. */}
                    <span
                      className={cn(
                        "text-right text-sm tabular-nums",
                        line.spend > 0
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {line.spend > 0 ? formatMoney(line.spend) : "—"}
                    </span>

                    <span className="text-right text-sm font-semibold tabular-nums">
                      {formatMoney(line.revenue)}
                    </span>

                    <span
                      className={cn(
                        "text-right text-sm font-semibold tabular-nums",
                        line.roas === null &&
                          "font-normal text-muted-foreground",
                        burning && "text-destructive",
                      )}
                    >
                      {formatRoas(line.roas)}
                    </span>

                    <MarginCell line={line} />
                  </div>
                );
              })
            )}

            {/* Unattributed is a line of its own, below the campaigns and visually
                apart from them — never folded into one, which would flatter it.
                It carries no spend and no ROAS: nobody bought this traffic. */}
            <div
              className={cn("grid items-center bg-muted/10 px-5 py-4", COLUMNS)}
            >
              <div className="min-w-0 pr-4">
                <p className="truncate text-sm font-medium leading-none">
                  Unattributed
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  No qualifying touch — direct arrivals, untagged links, and
                  touches outside the lookback window.
                </p>
                <Bar value={report.unattributed.revenue} max={max} />
              </div>
              <span />
              <span />
              <span className="text-right text-sm tabular-nums">
                {report.unattributed.orders.toLocaleString()}
              </span>
              <span className="text-right text-sm text-muted-foreground">
                —
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {formatMoney(report.unattributed.revenue)}
              </span>
              <span className="text-right text-sm text-muted-foreground">
                —
              </span>
              {/* No spend went into this bucket, so there is no contribution to
                  attribute to one. Not a zero — a zero would be a claim. */}
              <span className="text-right text-sm text-muted-foreground">
                —
              </span>
            </div>
          </div>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Attribution is resolved every time this page loads, so a campaign
        created after its ads ran claims the orders they drove, and a matching
        rule added today repairs these figures rather than only affecting new
        orders. Revenue counts paid, processing, shipped and delivered orders —
        the same ones the dashboard and analytics report — and is unchanged by
        the spend beside it. A campaign appears here if it is active, earned
        revenue in the period, or had spend recorded against it. ROAS is a
        ratio, not an amount: it is blank for a campaign nothing was spent on.
        Cost of goods counts only the lines whose variant has a cost price, and
        the percentage under each margin says how much of that campaign&apos;s
        goods revenue that covers — where nothing is costed the margin is
        withheld rather than reported, because a margin computed from no cost
        data would read as pure profit.
      </p>
    </div>
  );
}
