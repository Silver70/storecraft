import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { formatMoney } from "~/lib/money";
import { Badge } from "~/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type {
  Period,
  RevenueBucket,
  RulePreviewOverlap,
  RulePreviewReport,
  RulePreviewSampleOrder,
} from "~/types/api";
import {
  campaignRulePreviewQueryOptions,
  type RulePreviewCandidate,
} from "../queries";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

function orderCount(bucket: RevenueBucket): string {
  return `${bucket.orders.toLocaleString()} order${bucket.orders === 1 ? "" : "s"}`;
}

function share(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(0)}%`;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * What a candidate rule would do, shown before it is saved.
 *
 * Attribution is resolved every time a report is read, so a saved rule changes
 * figures the merchant has already seen — that is what lets a correction repair
 * the past, and what lets an over-broad rule rewrite it. This panel is the
 * moment that consequence is legible: not just what the rule wins, but whose
 * revenue it takes and what it reaches for and loses.
 *
 * Nothing here saves anything. The rule is still a draft until Add is pressed.
 */
export function RulePreviewPanel({
  campaignId,
  candidate,
  period,
  onPeriodChange,
}: {
  campaignId: string;
  candidate: RulePreviewCandidate;
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  const {
    data: preview,
    isPending,
    error,
  } = useQuery(
    campaignRulePreviewQueryOptions(campaignId, candidate, period, "last"),
  );

  return (
    <div className="space-y-4 rounded-md border border-dashed bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          If you save this rule
          <span className="ml-1.5 font-normal text-muted-foreground">
            — nothing is saved yet
          </span>
        </p>
        <Select
          value={period}
          onValueChange={(next) => onPeriodChange(next as Period)}
        >
          <SelectTrigger
            className="h-8 w-[150px] text-xs"
            aria-label="Preview period"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
          Checking this rule against your orders…
        </p>
      ) : error ? (
        <p className="text-xs text-destructive">{error.message}</p>
      ) : (
        <PreviewBody preview={preview} />
      )}
    </div>
  );
}

function PreviewBody({ preview }: { preview: RulePreviewReport }) {
  const claimsEverything =
    preview.claimed.orders > 0 &&
    preview.totals.orders > 0 &&
    preview.claimed.orders / preview.totals.orders >= 0.8;

  return (
    <div className="space-y-4">
      {preview.duplicate && (
        <Note>
          This campaign already has a rule that means the same thing, so saving
          it would be refused. Matching ignores case, hyphens, underscores and
          spacing.
        </Note>
      )}

      {/* What the rule would actually be stored as, when that differs from what
          was typed — a pasted link becomes a host, and the merchant should not
          discover that after saving. */}
      {preview.rule.value !== preview.rule.normalizedValue && (
        <p className="text-xs text-muted-foreground">
          Stored as <code className="font-mono">{preview.rule.value}</code>, and
          compared as{" "}
          <code className="font-mono">{preview.rule.normalizedValue}</code>.
        </p>
      )}

      {/* ── The headline ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure
          label="Would claim"
          value={formatMoney(preview.claimed.revenue)}
          hint={`${orderCount(preview.claimed)} — ${share(
            preview.claimed.revenue,
            preview.totals.revenue,
          )} of the period's revenue`}
        />
        <Figure
          label="Of that, unattributed today"
          value={formatMoney(preview.fromUnattributed.revenue)}
          hint={`${orderCount(preview.fromUnattributed)} with no campaign`}
        />
        <Figure
          label={`${preview.campaignName} after`}
          value={formatMoney(preview.campaignAfter.revenue)}
          hint={`${formatMoney(preview.campaignBefore.revenue)} today`}
        />
      </div>

      {claimsEverything && (
        <Note>
          This rule claims{" "}
          {share(preview.claimed.orders, preview.totals.orders)} of the orders
          in this period. A rule that broad usually means the value is not
          specific to this campaign.
        </Note>
      )}

      {preview.claimed.orders === 0 && !preview.duplicate && (
        <p className="text-xs text-muted-foreground">
          No order in this period would move onto this campaign. Try a wider
          period, or check the value against the links you actually sent out.
        </p>
      )}

      {/* ── Overlaps ──────────────────────────────────────────────────────── */}
      {preview.overlaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Other campaigns this rule meets</p>
          <ul className="divide-y rounded-md border bg-background">
            {preview.overlaps.map((overlap) => (
              <OverlapRow key={overlap.campaignId} overlap={overlap} />
            ))}
          </ul>
        </div>
      )}

      {/* ── The orders themselves ─────────────────────────────────────────── */}
      {preview.samples.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">
            Orders it would claim
            {preview.claimed.orders > preview.samples.length && (
              <span className="ml-1 font-normal text-muted-foreground">
                — showing {preview.samples.length} of{" "}
                {preview.claimed.orders.toLocaleString()}
              </span>
            )}
          </p>
          <ul className="divide-y rounded-md border bg-background">
            {preview.samples.map((sample) => (
              <SampleRow key={sample.orderId} sample={sample} />
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Resolved on last touch over the same orders the attributed revenue
        report counts, within the {preview.lookbackDays}-day lookback window.
        Bot traffic and touches older than the window are never claimed.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * One campaign the rule meets, in both directions: revenue it would take away,
 * and revenue it reaches for but loses to a rule that outranks it. Kept on one
 * row rather than in two lists, so an overlap is read once.
 */
function OverlapRow({ overlap }: { overlap: RulePreviewOverlap }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate font-medium">
        {overlap.name}
      </span>

      {overlap.taken.orders > 0 && (
        <Badge variant="destructive" className="gap-1 font-normal">
          Takes {formatMoney(overlap.taken.revenue)}
          <span className="opacity-80">({orderCount(overlap.taken)})</span>
        </Badge>
      )}

      {overlap.blocked.orders > 0 && (
        <span
          className="text-muted-foreground"
          // Not a failure — precedence working. A campaign-tag rule outranks a
          // source or medium rule, and an exact match outranks a prefix.
          title="This campaign's rule outranks yours, so these orders stay with it."
        >
          Keeps {formatMoney(overlap.blocked.revenue)} (
          {orderCount(overlap.blocked)})
        </span>
      )}
    </li>
  );
}

function SampleRow({ sample }: { sample: RulePreviewSampleOrder }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
      <span className="font-mono">{sample.orderNumber}</span>
      <span className="text-muted-foreground">
        {dateFormat.format(new Date(sample.placedAt))}
      </span>

      {sample.matchedValue !== null && (
        <code className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {sample.matchedValue}
        </code>
      )}

      <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
        {sample.currentCampaignName ?? "Unattributed"}
        <ArrowRightIcon className="h-3 w-3" />
      </span>
      <span className="font-medium tabular-nums">
        {formatMoney(sample.total)}
      </span>
    </li>
  );
}

/** Something the merchant should read before pressing Add. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>{children}</span>
    </p>
  );
}
