import type * as React from "react";
import { LayoutGridIcon, TableIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { Campaign, CampaignPlatform, CampaignStatus } from "~/types/api";
import type { PerformanceFilters, SortKey } from "../performance-rows";
import { formatPlatform } from "../utils";
import type { ViewMode } from "../use-view-mode";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "spend", label: "Spend" },
  { value: "roas", label: "ROAS" },
  { value: "margin", label: "Margin" },
  { value: "name", label: "Name" },
];

const STATUSES: { value: CampaignStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All statuses" },
];

/**
 * Finding one push among many, and choosing how to read them.
 *
 * The status filter selects campaigns and not ads. An archived ad that earned
 * or spent in the period stays visible under its campaign, because that is the
 * report's own rule and hiding it would hide money.
 */
export function CampaignFilters({
  campaigns,
  platforms,
  filters,
  onChange,
  view,
  onViewChange,
  matched,
}: {
  campaigns: readonly Campaign[];
  platforms: readonly CampaignPlatform[];
  filters: PerformanceFilters;
  onChange: (next: PerformanceFilters) => void;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  /** How many campaigns survived the filters, so an empty page is explicable. */
  matched: number;
}) {
  const set = <K extends keyof PerformanceFilters>(
    key: K,
    value: PerformanceFilters[K],
  ) => onChange({ ...filters, [key]: value });

  // Naming one campaign already answers the question these two narrow, so they
  // are visibly moot rather than silently ignored.
  const narrowing = filters.campaignId === "all";

  const byName = [...campaigns].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.campaignId}
        onValueChange={(value) => set("campaignId", value)}
      >
        <SelectTrigger size="sm" className="w-[190px]">
          <SelectValue placeholder="All campaigns" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All campaigns</SelectItem>
          {byName.map((campaign) => (
            <SelectItem key={campaign.id} value={campaign.id}>
              {campaign.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.platform}
        disabled={!narrowing}
        onValueChange={(value) =>
          set("platform", value as CampaignPlatform | "all")
        }
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue placeholder="All platforms" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All platforms</SelectItem>
          {platforms.map((platform) => (
            <SelectItem key={platform} value={platform}>
              {formatPlatform(platform)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(value) =>
          set("status", value as CampaignStatus | "all")
        }
      >
        <SelectTrigger size="sm" className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((status) => (
            <SelectItem key={status.value} value={status.value}>
              {status.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.sort}
        onValueChange={(value) => set("sort", value as SortKey)}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((sort) => (
            <SelectItem key={sort.value} value={sort.value}>
              Sort by {sort.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-xs text-muted-foreground">
        {matched} campaign{matched === 1 ? "" : "s"}
      </span>

      <div className="ml-auto flex items-center rounded-md border p-0.5">
        <ViewButton
          active={view === "cards"}
          onClick={() => onViewChange("cards")}
          label="Card view"
        >
          <LayoutGridIcon className="h-3.5 w-3.5" />
        </ViewButton>
        <ViewButton
          active={view === "table"}
          onClick={() => onViewChange("table")}
          label="Table view"
        >
          <TableIcon className="h-3.5 w-3.5" />
        </ViewButton>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex h-7 w-8 items-center justify-center rounded transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
