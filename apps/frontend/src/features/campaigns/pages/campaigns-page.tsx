import * as React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { MegaphoneIcon } from "lucide-react";

import { Card } from "~/components/ui/card";
import type { AttributedRevenueReport, Period } from "~/types/api";
import {
  adPlatformConnectionsQueryOptions,
  attributedRevenueQueryOptions,
} from "../queries";
import {
  CampaignSection,
  UnattributedCard,
} from "../components/campaign-cards";
import {
  AdAccountPicker,
  ConnectMetaEmptyState,
  ConnectionResultNote,
  MetaConnectionSummary,
  metaConnection,
} from "../components/meta-connection";

const route = getRouteApi("/admin/campaigns_/");

/**
 * Which campaigns are running, and how much money each one made.
 *
 * Every campaign here is one on the store's connected ad account, and every
 * order is credited to the latest ad click by the platform ids its link
 * carried. One period governs everything below it, so two figures on screen
 * are never from two different windows.
 */
export function CampaignsPage() {
  const [period, setPeriod] = React.useState<Period>("30d");
  const search = route.useSearch();

  // The selector re-keys the report query, which suspends. Inside a transition
  // React keeps the current figures on screen until the new ones arrive rather
  // than dropping the page to the route's fallback — a period switch should
  // read as the numbers changing, not as the page reloading.
  const [pending, startTransition] = React.useTransition();

  const connection = metaConnection(
    useSuspenseQuery(adPlatformConnectionsQueryOptions()).data,
  );
  const report: AttributedRevenueReport = useSuspenseQuery(
    attributedRevenueQueryOptions(period),
  ).data;

  // Before a connection the whole page is one empty state with one button.
  // There is nothing else here yet that is true: every campaign on this page is
  // one on an ad account, and there is no ad account.
  if (!connection) {
    return (
      <div className="space-y-6 pb-10">
        <Header />
        {search.ad_platform_result && (
          <ConnectionResultNote result={search.ad_platform_result} />
        )}
        <ConnectMetaEmptyState />
      </div>
    );
  }

  // Approved at Meta, but nobody has said which ad account belongs to this
  // store. That is our question, and it is the only one worth asking until it
  // is answered.
  if (connection.status === "awaiting_account") {
    return (
      <div className="space-y-6 pb-10">
        <Header />
        {search.ad_platform_result && (
          <ConnectionResultNote result={search.ad_platform_result} />
        )}
        <AdAccountPicker />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Header />

        {/* Whose account these figures came from, and how fresh they are. */}
        <MetaConnectionSummary connection={connection} />
      </div>

      {search.ad_platform_result && (
        <ConnectionResultNote result={search.ad_platform_result} />
      )}

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
        {report.campaigns.length === 0 ? (
          <EmptyStore />
        ) : (
          <div className="space-y-8">
            {report.campaigns.map((line) => (
              <CampaignSection
                key={line.campaignId}
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
        Each order is credited to the latest ad click: the last visit if it came
        from one of these campaigns, otherwise the first. Revenue counts paid,
        processing, shipped and delivered orders — the same ones the dashboard
        and analytics report.
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

/** The page's own title, on the screens that have nothing else on them yet. */
function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        The campaigns on your connected ad account, and what each one earned.
      </p>
    </div>
  );
}

/** No campaigns at all. */
function EmptyStore() {
  return (
    <Card className="flex flex-col items-center gap-2 py-16 text-center">
      <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        No campaigns yet. They appear here from your connected ad account.
      </p>
    </Card>
  );
}
