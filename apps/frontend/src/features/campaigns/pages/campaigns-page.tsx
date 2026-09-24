import * as React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { MegaphoneIcon, PlusIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import type { AdPlatformConnection } from "~/types/api";
import {
  adPlatformConnectionsQueryOptions,
  attributedRevenueQueryOptions,
} from "../queries";
import { CampaignCard } from "../components/campaign-cards";
import {
  AdAccountPicker,
  ConnectMetaEmptyState,
  ConnectionResultNote,
  MetaConnectionSummary,
  metaConnection,
} from "../components/meta-connection";
import { GRID_PERIOD, arrangeGrid } from "../utils";

const route = getRouteApi("/admin/campaigns_/");

/**
 * Which campaigns are running, and how much money each one made.
 *
 * A card per campaign and nothing else: no summary strip, no filters, no date
 * controls. Every card reports the same fixed window, stated once at the top,
 * so any two can be compared. Everything a card leaves out is on the
 * campaign's own page.
 */
export function CampaignsPage() {
  const search = route.useSearch();

  const connection = metaConnection(
    useSuspenseQuery(adPlatformConnectionsQueryOptions()).data,
  );

  // Before a connection the whole page is one empty state with one button.
  // There is nothing else here yet that is true: every campaign on this page is
  // one on an ad account, and there is no ad account.
  if (!connection) {
    return (
      <div className="space-y-6 pb-10">
        <Title />
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
        <Title />
        {search.ad_platform_result && (
          <ConnectionResultNote result={search.ad_platform_result} />
        )}
        <AdAccountPicker />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Title showWindow />
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {/* A disconnected account's campaigns stay readable, and nothing new
              can be made on it. */}
          {connection.status === "connected" && (
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/admin/campaigns/new">
                <PlusIcon className="h-4 w-4" />
                Create campaign
              </Link>
            </Button>
          )}
          {/* Whose account these figures came from, how fresh they are, and
              whether the last attempt to refresh them failed. */}
          <MetaConnectionSummary connection={connection} />
        </div>
      </div>

      {search.ad_platform_result && (
        <ConnectionResultNote result={search.ad_platform_result} />
      )}

      <CampaignGrid connection={connection} />
    </div>
  );
}

/**
 * The cards, and the search over them.
 *
 * The report is read from figures already stored, so a sync that failed an
 * hour ago costs these cards freshness and nothing else — the header line says
 * so, and the grid draws what it has.
 */
function CampaignGrid({ connection }: { connection: AdPlatformConnection }) {
  const report = useSuspenseQuery(
    attributedRevenueQueryOptions(GRID_PERIOD),
  ).data;

  const [query, setQuery] = React.useState("");
  const [showOlder, setShowOlder] = React.useState(false);

  const { shown, older } = React.useMemo(
    () => arrangeGrid(report.campaigns, report.rangeStart, query),
    [report.campaigns, report.rangeStart, query],
  );

  if (report.campaigns.length === 0) {
    return <NoCampaignsYet connection={connection} />;
  }

  const visible = showOlder ? [...shown, ...older] : shown;

  return (
    <div className="space-y-5">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search campaigns"
          aria-label="Search campaigns by name"
          className="h-9 pl-9 text-sm"
        />
      </div>

      {visible.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((line) => (
            <CampaignCard key={line.campaignId} line={line} />
          ))}
        </div>
      ) : (
        older.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No campaign is called anything like &ldquo;{query.trim()}&rdquo;.
          </p>
        )
      )}

      {/* Older finished campaigns: out of the way, not gone. */}
      {older.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOlder((open) => !open)}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {showOlder
            ? "Hide older campaigns"
            : `Show older campaigns (${older.length})`}
        </button>
      )}
    </div>
  );
}

/**
 * The page's title, and — once there are figures — the one window every card
 * reports, said here so no card has to say it.
 */
function Title({ showWindow = false }: { showWindow?: boolean }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      {showWindow && (
        <p className="text-sm text-muted-foreground">
          Revenue over the last 30 days
        </p>
      )}
    </div>
  );
}

/**
 * Connected, and nothing on the account yet.
 *
 * Said outright rather than left as an empty page, which would read as the
 * connection not working.
 */
function NoCampaignsYet({ connection }: { connection: AdPlatformConnection }) {
  const account = connection.accountName ?? connection.accountId;
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium">No campaigns yet</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {connection.status === "disconnected"
          ? `Meta is disconnected, and no campaigns were pulled from ${account} before it was.`
          : connection.lastSyncedAt
            ? `Meta is connected, and ${account} has no campaigns on it. Create one here, or in Ads Manager, where it appears here within the hour.`
            : `Meta is connected. Campaigns on ${account} appear here once the first refresh finishes.`}
      </p>
    </Card>
  );
}
