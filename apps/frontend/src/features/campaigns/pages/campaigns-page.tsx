import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MegaphoneIcon, PlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type {
  AttributedRevenueReport,
  AttributionTouch,
  Campaign,
  Period,
} from "~/types/api";
import {
  attributedRevenueQueryOptions,
  campaignsQueryOptions,
} from "../queries";
import {
  DEFAULT_FILTERS,
  filterGroups,
  groupCampaigns,
  platformsInUse,
  sortGroups,
  type PerformanceFilters,
} from "../performance-rows";
import { useViewMode } from "../use-view-mode";
import {
  CampaignSection,
  UnattributedCard,
} from "../components/campaign-cards";
import { CampaignFilters } from "../components/campaign-filters";
import {
  AttributionTouchTabs,
  PerformancePeriodTabs,
  attributionTouchHint,
} from "../components/campaign-performance-controls";
import {
  PerformanceCaveats,
  PerformanceSummary,
  RevenueBasisNote,
} from "../components/performance-summary";
import { PerformanceTable } from "../components/performance-table";

/**
 * Campaigns and their ads: what they are, and what they did.
 *
 * One page rather than two. Managing lived at `/admin/campaigns` and measuring
 * at `/admin/campaigns/revenue`, so performance sat somewhere other than the
 * thing it described, with its own period selector — and a merchant comparing
 * two campaigns had to hold figures in their head across a navigation.
 *
 * **One period and one touch govern everything below them.** Both reads are
 * keyed on the same pair, so two figures on screen are never from two different
 * windows. That is the whole reason the selectors sit above the summary rather
 * than beside the list they most obviously affect.
 *
 * Two views of one list. Cards are how a merchant compares four creatives —
 * they carry the picture, which is what an ad is actually recognised by — and a
 * dense table is how anyone reads forty. The switch changes the shape of the
 * page and never its contents.
 */
export function CampaignsPage() {
  const [period, setPeriod] = React.useState<Period>("30d");
  const [touch, setTouch] = React.useState<AttributionTouch>("last");
  const [filters, setFilters] =
    React.useState<PerformanceFilters>(DEFAULT_FILTERS);
  const [view, setView] = useViewMode();

  // Both selectors re-key the report query, which suspends. Inside a transition
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
    attributedRevenueQueryOptions(period, touch),
  ).data;

  const groups = React.useMemo(
    () =>
      sortGroups(
        filterGroups(groupCampaigns(campaigns, report), filters),
        filters.sort,
      ),
    [campaigns, report, filters],
  );

  const platforms = React.useMemo(() => platformsInUse(campaigns), [campaigns]);

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            One campaign per thing you spend money on, and one ad per creative
            running under it. What each cost, what it produced, and the return
            between the two — resolved from the tags each order carried when it
            was placed.
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

      {/* ── The one period, and the one touch ─────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <PerformancePeriodTabs
            value={period}
            onValueChange={(next) => startTransition(() => setPeriod(next))}
          />
          <AttributionTouchTabs
            value={touch}
            onValueChange={(next) => startTransition(() => setTouch(next))}
          />
        </div>
        <PerformanceCaveats lookbackDays={report.lookbackDays} />
      </div>

      <p className="text-xs text-muted-foreground">
        {attributionTouchHint(touch)}
      </p>

      <div
        className={
          pending ? "opacity-60 transition-opacity" : "transition-opacity"
        }
      >
        <div className="space-y-6">
          <PerformanceSummary report={report} />
          <RevenueBasisNote />

          {/* ── Finding one push among many ─────────────────────────────── */}
          <CampaignFilters
            campaigns={campaigns}
            platforms={platforms}
            filters={filters}
            onChange={setFilters}
            view={view}
            onViewChange={setView}
            matched={groups.length}
          />

          {campaigns.length === 0 ? (
            <EmptyStore />
          ) : view === "table" ? (
            <PerformanceTable groups={groups} report={report} />
          ) : groups.length === 0 ? (
            <NoMatches />
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
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Attribution is resolved every time this page loads, so a campaign
        created after its ads ran claims the orders they drove, and a matching
        rule added today repairs these figures rather than only affecting new
        orders. Revenue counts paid, processing, shipped and delivered orders —
        the same ones the dashboard and analytics report — and is unchanged by
        the spend beside it. A campaign or an ad appears with figures if it is
        active, earned revenue in the period, or had spend recorded against it.
        ROAS is a ratio, not an amount: it is blank for anything nothing was
        spent on. Cost of goods counts only the lines whose variant has a cost
        price, and the coverage under each margin says how much of that
        line&apos;s goods revenue that covers — where nothing is costed the
        margin is withheld rather than reported, because a margin computed from
        no cost data would read as pure profit.
      </p>
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

function NoMatches() {
  return (
    <Card className="flex flex-col items-center gap-2 py-16 text-center">
      <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        Nothing matches these filters.
      </p>
    </Card>
  );
}
