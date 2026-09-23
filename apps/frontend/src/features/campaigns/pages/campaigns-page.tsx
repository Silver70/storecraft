import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MegaphoneIcon, PlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type { AttributedRevenueReport, Campaign, Period } from "~/types/api";
import {
  attributedRevenueQueryOptions,
  campaignsQueryOptions,
} from "../queries";
import { groupCampaigns } from "../performance-rows";
import {
  CampaignSection,
  UnattributedCard,
} from "../components/campaign-cards";

/**
 * Which campaigns are running, and how much money each one made.
 *
 * That question is the whole page now. What used to sit above it — a KPI
 * summary strip, a filter bar, a first/last-touch toggle and a card/table
 * switch — was four controls wrapped around a report that was mostly figures
 * the merchant had typed in themselves. The figures went; the controls had
 * nothing left to arrange.
 *
 * Credit is the last touch. The toggle offered first touch as an alternative,
 * which asked a merchant to hold two attribution models in mind and pick one
 * per glance; there is one model here now, and the lookback window under each
 * revenue figure is the whole of the explanation this page offers.
 *
 * One period governs everything below it, so two figures on screen are never
 * from two different windows.
 */
export function CampaignsPage() {
  const [period, setPeriod] = React.useState<Period>("30d");

  // The selector re-keys the report query, which suspends. Inside a transition
  // React keeps the current figures on screen until the new ones arrive rather
  // than dropping the page to the route's fallback — a period switch should
  // read as the numbers changing, not as the page reloading.
  const [pending, startTransition] = React.useTransition();

  // Both tabs of campaigns come from one read of everything: the list is small,
  // and fetching per status would make archiving feel like the campaign
  // vanished.
  const campaigns: Campaign[] = useSuspenseQuery(
    campaignsQueryOptions("all"),
  ).data;
  const report: AttributedRevenueReport = useSuspenseQuery(
    attributedRevenueQueryOptions(period, "last"),
  ).data;

  const groups = React.useMemo(
    () => groupCampaigns(campaigns, report),
    [campaigns, report],
  );

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            One campaign per thing you spend money on, and one ad per creative
            running under it. What each one earned, resolved from the tags each
            order carried when it was placed.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button className="gap-2 px-5 py-2.5" asChild>
            <Link to="/admin/campaigns/new">
              <PlusIcon className="h-4 w-4" />
              Create campaign
            </Link>
          </Button>
        </div>
      </div>

      {/* ── The one period ────────────────────────────────────────────────── */}
      <PeriodTabs
        value={period}
        onValueChange={(next) => startTransition(() => setPeriod(next))}
      />

      <div
        className={
          pending ? "opacity-60 transition-opacity" : "transition-opacity"
        }
      >
        {campaigns.length === 0 ? (
          <EmptyStore />
        ) : (
          <div className="space-y-8">
            {groups.map(({ campaign, line }) => (
              <CampaignSection
                key={campaign.id}
                campaign={campaign}
                line={line}
                lookbackDays={report.lookbackDays}
              />
            ))}

            <UnattributedCard
              orders={report.unattributed.orders}
              revenue={report.unattributed.revenue}
              realizedRevenue={report.totals.revenue}
            />
          </div>
        )}
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Attribution is resolved every time this page loads, so a campaign
        created after its ads ran claims the orders they drove, and a matching
        rule added today repairs these figures rather than only affecting new
        orders. Revenue counts paid, processing, shipped and delivered orders —
        the same ones the dashboard and analytics report. A campaign or an ad
        appears with figures if it is active or earned revenue in the period.
      </p>
    </div>
  );
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

/** The one control left on this page, and the one that governs every figure. */
function PeriodTabs({
  value,
  onValueChange,
}: {
  value: Period;
  onValueChange: (next: Period) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Reporting period"
      className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 p-1"
    >
      {PERIODS.map((period) => (
        <button
          key={period.value}
          type="button"
          role="tab"
          aria-selected={period.value === value}
          onClick={() => onValueChange(period.value)}
          className={
            period.value === value
              ? "rounded-md bg-background px-3 py-1 text-xs font-medium shadow-sm"
              : "rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

/** No campaigns at all — the one place on this page an invitation belongs. */
function EmptyStore() {
  return (
    <Card className="flex flex-col items-center gap-2 py-16 text-center">
      <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        No campaigns yet. Create one for the next thing you promote, and its
        orders will appear here.
      </p>
      <Button variant="outline" size="sm" className="mt-2 gap-2" asChild>
        <Link to="/admin/campaigns/new">
          <PlusIcon className="h-4 w-4" />
          Create campaign
        </Link>
      </Button>
    </Card>
  );
}
