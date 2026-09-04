import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ChartColumnIcon,
  ChevronRightIcon,
  MegaphoneIcon,
  PlusIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type { Campaign, CampaignStatus } from "~/types/api";
import { campaignsQueryOptions } from "../queries";
import { formatPlatform } from "../utils";
import { CampaignStatusBadge } from "../components/campaign-status-badge";

type Tab = { value: CampaignStatus; label: string };
const TABS: Tab[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const COLUMNS = "grid-cols-[1fr_minmax(0,220px)_120px_96px_40px]";

export function CampaignListPage() {
  // Both tabs come from one read of everything: the list is small, and fetching
  // per tab would make archiving feel like the campaign vanished.
  const campaigns: Campaign[] = useSuspenseQuery(
    campaignsQueryOptions("all"),
  ).data;
  const [tab, setTab] = React.useState<CampaignStatus>("active");

  const counts: Record<CampaignStatus, number> = {
    active: campaigns.filter((c) => c.status === "active").length,
    archived: campaigns.filter((c) => c.status === "archived").length,
  };

  const rows = campaigns.filter((c) => c.status === tab);

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            One campaign per thing you spend money on. Orders are attributed
            back to them from the tags on the links visitors arrive through.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2 px-4 py-2.5" asChild>
            <Link to="/admin/campaigns/revenue">
              <ChartColumnIcon className="h-4 w-4" />
              Attributed revenue
            </Link>
          </Button>
          <Button className="gap-2 px-5 py-2.5" asChild>
            <Link to="/admin/campaigns/new">
              <PlusIcon className="h-4 w-4" />
              Create campaign
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors",
              tab === t.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0 text-xs tabular-nums",
                tab === t.value
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {counts[t.value]}
            </span>
          </button>
        ))}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden gap-0 py-0">
        <div
          className={cn(
            "grid items-center border-b bg-muted/20 px-5 py-2.5 text-xs font-medium text-muted-foreground",
            COLUMNS,
          )}
        >
          <span>Name</span>
          <span>Tag</span>
          <span>Platform</span>
          <span className="text-center">Status</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {tab === "active"
                ? "No campaigns yet. Create one for the next thing you promote."
                : "No archived campaigns."}
            </p>
          </div>
        ) : (
          rows.map((c, i) => (
            <div
              key={c.id}
              className={cn(
                "grid items-center px-5 py-4 transition-colors hover:bg-muted/20",
                COLUMNS,
                i < rows.length - 1 && "border-b border-border/50",
              )}
            >
              {/* Name */}
              <div className="min-w-0 pr-4">
                <p className="truncate text-sm font-medium leading-none">
                  {c.name}
                </p>
                {c.externalId && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Ad platform ID {c.externalId}
                  </p>
                )}
              </div>

              {/* Canonical tag */}
              <code className="truncate pr-4 font-mono text-xs text-muted-foreground">
                {c.tag}
              </code>

              {/* Platform */}
              <span className="text-sm text-muted-foreground">
                {formatPlatform(c.platform)}
              </span>

              {/* Status */}
              <div className="flex justify-center">
                <CampaignStatusBadge status={c.status} />
              </div>

              {/* Action */}
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  asChild
                >
                  <Link
                    to="/admin/campaigns/$campaignId"
                    params={{ campaignId: c.id }}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
