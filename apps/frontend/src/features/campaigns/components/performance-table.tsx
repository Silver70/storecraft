import { Link } from "@tanstack/react-router";
import { CornerDownRightIcon, MegaphoneIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Card } from "~/components/ui/card";
import type { AttributedRevenueReport, PerformanceFigures } from "~/types/api";
import type { CampaignGroup } from "../performance-rows";
import {
  coverageNote,
  formatFlight,
  formatPlatform,
  formatRoas,
  isBurning,
} from "../utils";
import { CampaignStatusBadge } from "./campaign-status-badge";

const COLUMNS =
  "grid-cols-[minmax(200px,1fr)_110px_104px_76px_112px_124px_88px_150px]";

/**
 * Contribution margin with the coverage that qualifies it directly beneath.
 *
 * The two are one cell rather than two columns on purpose: a margin read
 * without its coverage is the failure this guards against, and a merchant
 * scanning a table will not look two columns away for the caveat on the number
 * they are looking at.
 */
function MarginCell({ line }: { line: PerformanceFigures }) {
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

/** The six figure columns, identical at every grain so a split reads as one. */
function FigureCells({
  line,
  lookbackDays,
  burning,
}: {
  line: PerformanceFigures;
  lookbackDays: number;
  burning?: boolean;
}) {
  return (
    <>
      <span className="text-right text-sm tabular-nums">
        {line.orders.toLocaleString()}
      </span>

      {/* An em dash rather than $0.00: no spend was recorded, which is a
          different statement from a day that cost nothing. */}
      <span
        className={cn(
          "text-right text-sm tabular-nums",
          line.spend > 0 ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {line.spend > 0 ? formatMoney(line.spend) : "—"}
      </span>

      <span className="text-right text-sm font-semibold tabular-nums">
        {formatMoney(line.revenue)}
      </span>

      <div className="text-right">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            line.roas === null && "font-normal text-muted-foreground",
            burning && "text-destructive",
          )}
        >
          {formatRoas(line.roas)}
        </span>
        {/* The window travels with every ROAS here too — it is the reason this
            figure and the ad platform's disagree. */}
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground/70">
          {line.roas === null ? "nothing spent" : `${lookbackDays}-day`}
        </p>
      </div>

      <MarginCell line={line} />
    </>
  );
}

/**
 * The same page, dense.
 *
 * A card grid is how a merchant compares four creatives and is not how anyone
 * reads forty. Both views are driven by the same joined, filtered and sorted
 * list, so switching changes the shape of the page and never what is on it —
 * two views that disagreed about which campaigns exist would be worse than
 * either being wrong, since nothing on screen would say which to believe.
 */
export function PerformanceTable({
  groups,
  report,
}: {
  groups: readonly CampaignGroup[];
  report: AttributedRevenueReport;
}) {
  const lookbackDays = report.lookbackDays;

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="overflow-x-auto">
        <div className="min-w-260">
          <div
            className={cn(
              "grid items-center border-b bg-muted/20 px-5 py-2.5 text-xs font-medium text-muted-foreground",
              COLUMNS,
            )}
          >
            <span>Campaign / ad</span>
            <span>Platform</span>
            <span className="text-center">Status</span>
            <span className="text-right">Purchases</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">ROAS</span>
            <span className="text-right">Contribution margin</span>
          </div>

          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <MegaphoneIcon className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Nothing matches these filters.
              </p>
            </div>
          ) : (
            groups.map(({ campaign, line }) => {
              const burning = line ? isBurning(line) : false;
              const ads = line?.ads ?? [];

              return (
                <div key={campaign.id}>
                  {/* ── The campaign ─────────────────────────────────────── */}
                  <div
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
                          params={{ campaignId: campaign.id }}
                          className="truncate text-sm font-medium leading-none hover:underline"
                        >
                          {campaign.name}
                        </Link>
                        {burning && (
                          <span className="shrink-0 rounded-full border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive">
                            No revenue
                          </span>
                        )}
                      </div>
                      <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                        {campaign.tag}
                      </code>
                    </div>

                    <span className="text-sm text-muted-foreground">
                      {formatPlatform(campaign.platform)}
                    </span>

                    <div className="flex justify-center">
                      <CampaignStatusBadge status={campaign.status} />
                    </div>

                    {line ? (
                      <FigureCells
                        line={line}
                        lookbackDays={lookbackDays}
                        burning={burning}
                      />
                    ) : (
                      // No figures rather than zeroes, for the reason the card
                      // gives: the report made no claim about this period.
                      <span className="col-span-5 text-right text-xs text-muted-foreground">
                        No revenue or spend in this period
                      </span>
                    )}
                  </div>

                  {/* ── Its creatives ────────────────────────────────────── */}
                  {ads.map((ad) => {
                    const adBurning = isBurning(ad);
                    const flight = formatFlight(ad.startsAt, ad.endsAt);

                    return (
                      <div
                        key={ad.adId}
                        className={cn(
                          "grid items-center border-b border-border/50 py-3 pl-10 pr-5 transition-colors",
                          COLUMNS,
                          adBurning
                            ? "bg-destructive/5 hover:bg-destructive/10"
                            : "bg-muted/5 hover:bg-muted/20",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-2 pr-4">
                          <CornerDownRightIcon
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                            aria-hidden
                          />
                          {ad.creativeUrl && (
                            <img
                              src={ad.creativeUrl}
                              alt=""
                              loading="lazy"
                              className="h-8 w-8 shrink-0 rounded border border-border/60 object-cover"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "truncate text-sm leading-none",
                                  ad.status === "archived" &&
                                    "text-muted-foreground",
                                )}
                              >
                                {ad.name}
                              </span>
                              {adBurning && (
                                <span className="shrink-0 rounded-full border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive">
                                  No revenue
                                </span>
                              )}
                            </div>
                            <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                              {ad.tag}
                              {flight ? ` · ${flight}` : ""}
                            </code>
                          </div>
                        </div>

                        {/* An ad has no platform of its own — it inherits its
                            campaign's, because funding is per ad account. */}
                        <span className="text-xs text-muted-foreground/70">
                          {formatPlatform(campaign.platform)}
                        </span>

                        <div className="flex justify-center">
                          {ad.status === "archived" ? (
                            <CampaignStatusBadge status="archived" />
                          ) : (
                            <span />
                          )}
                        </div>

                        <FigureCells
                          line={ad}
                          lookbackDays={lookbackDays}
                          burning={adBurning}
                        />
                      </div>
                    );
                  })}

                  {/* ── The residue between them ─────────────────────────── */}
                  {line && ads.length > 0 && (
                    <div
                      className={cn(
                        "grid items-center border-b border-border/50 bg-muted/10 py-3 pl-10 pr-5",
                        COLUMNS,
                      )}
                    >
                      <div className="min-w-0 pr-4">
                        <p className="truncate text-sm italic leading-none text-muted-foreground">
                          Unassigned
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          No ad tag on the link, or a tag no ad here owns
                        </p>
                      </div>
                      <span />
                      <span />
                      <FigureCells
                        line={line.unassigned}
                        lookbackDays={lookbackDays}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* ── The store-level residue ──────────────────────────────────── */}
          {/* Below the campaigns and visually apart from them, never folded
              into one, which would flatter it. It carries no spend and no
              ROAS: nobody bought this traffic. */}
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
            </div>
            <span />
            <span />
            <span className="text-right text-sm tabular-nums">
              {report.unattributed.orders.toLocaleString()}
            </span>
            <span className="text-right text-sm text-muted-foreground">—</span>
            <span className="text-right text-sm font-semibold tabular-nums">
              {formatMoney(report.unattributed.revenue)}
            </span>
            <span className="text-right text-sm text-muted-foreground">—</span>
            {/* No spend went into this bucket, so there is no contribution to
                attribute to one. Not a zero — a zero would be a claim. */}
            <span className="text-right text-sm text-muted-foreground">—</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
