import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, ImageIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type {
  AdRevenueLine,
  CampaignRevenueLine,
  RevenueBucket,
} from "~/types/api";
import { formatAdFormat, formatFlight, formatPlatform } from "../utils";
import { CampaignStatusBadge } from "./campaign-status-badge";
import { FigureList } from "./performance-figures";

/**
 * The picture a merchant recognises a campaign or an ad by.
 *
 * The empty state is drawn as a deliberate tile rather than as a hole where a
 * picture failed to load, and an image whose URL fails falls back to the same
 * tile, so the one thing that cannot appear is a broken image.
 */
export function CreativeTile({
  src,
  name,
}: {
  src: string | null;
  name: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  const showing = src && !failed;

  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md",
        showing
          ? "border border-border/60"
          : "border-2 border-dashed border-border bg-muted/30 text-muted-foreground/60",
      )}
    >
      {showing ? (
        <img
          src={src}
          alt={`Creative for ${name}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <ImageIcon className="h-4 w-4" aria-hidden />
      )}
    </div>
  );
}

/** A campaign, with what the period says about it. */
function CampaignCard({
  line,
  lookbackDays,
}: {
  line: CampaignRevenueLine;
  lookbackDays: number;
}) {
  const schedule = formatFlight(line.startsAt, line.endsAt);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <CreativeTile src={line.coverUrl} name={line.name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/admin/campaigns/$campaignId"
                params={{ campaignId: line.campaignId }}
                className="truncate text-base font-semibold leading-none hover:underline"
              >
                {line.name}
              </Link>
              <CampaignStatusBadge status={line.status} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formatPlatform(line.platform)}
              {schedule ? ` · ${schedule}` : ""}
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link
            to="/admin/campaigns/$campaignId"
            params={{ campaignId: line.campaignId }}
          >
            View
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="border-t bg-muted/10 px-5 py-4">
        <FigureList
          line={line}
          lookbackDays={lookbackDays}
          tracked={line.hasLinkTags}
          layout="row"
        />
      </div>
    </Card>
  );
}

/** One creative, with the figures that are its own and not the campaign's. */
function AdCard({
  ad,
  lookbackDays,
}: {
  ad: AdRevenueLine;
  lookbackDays: number;
}) {
  const format = formatAdFormat(ad.format);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <CreativeTile src={ad.creativeUrl} name={ad.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-none">{ad.name}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <CampaignStatusBadge status={ad.status} />
            {format && (
              <span className="text-[11px] text-muted-foreground">
                {format}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <FigureList
          line={ad}
          lookbackDays={lookbackDays}
          tracked={ad.hasLinkTags}
        />
      </div>
    </Card>
  );
}

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * What this campaign earned that named none of its ads — only possible when a
 * link's tags were edited by hand.
 *
 * Shown only when there is any, and never redistributed across the ads above
 * it. It is also not unattributed: those orders have no campaign at all, these
 * have this one.
 */
function NotLinkedToAnAdCard({
  line,
  campaignRevenue,
  lookbackDays,
}: {
  line: RevenueBucket;
  campaignRevenue: number;
  lookbackDays: number;
}) {
  return (
    <Card className="gap-0 overflow-hidden border-dashed py-0">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground/60">
          <TriangleAlertIcon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-none text-muted-foreground">
            Not linked to an ad
          </p>
          <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
            {share(line.revenue, campaignRevenue).toFixed(0)}% of this
            campaign&apos;s revenue.
          </p>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <FigureList line={line} lookbackDays={lookbackDays} />
      </div>
    </Card>
  );
}

/** A campaign and its ads, as one block. */
export function CampaignSection({
  line,
  lookbackDays,
}: {
  line: CampaignRevenueLine;
  lookbackDays: number;
}) {
  return (
    <section aria-label={line.name} className="space-y-3">
      <CampaignCard line={line} lookbackDays={lookbackDays} />

      {line.ads.length > 0 && (
        <div className="grid gap-3 pl-0 sm:grid-cols-2 sm:pl-6 xl:grid-cols-3">
          {line.ads.map((ad) => (
            <AdCard key={ad.adId} ad={ad} lookbackDays={lookbackDays} />
          ))}
          {line.unassigned.orders > 0 && (
            <NotLinkedToAnAdCard
              line={line.unassigned}
              campaignRevenue={line.revenue}
              lookbackDays={lookbackDays}
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The revenue no campaign explains — direct arrivals, links naming no campaign
 * of this store, and touches outside the lookback window.
 *
 * Its own card at the foot of the page, never folded into a campaign, which
 * would flatter it.
 */
export function UnattributedCard({
  orders,
  revenue,
  realizedRevenue,
}: {
  orders: number;
  revenue: number;
  realizedRevenue: number;
}) {
  return (
    <Card className="gap-0 border-dashed bg-muted/10 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-none">Unattributed</p>
          <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
            No ad click — direct arrivals, links naming no campaign here, and
            clicks outside the lookback window.
          </p>
        </div>
        <div className="flex shrink-0 gap-6">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Purchases
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {orders.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Revenue</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatMoney(revenue)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {share(revenue, realizedRevenue).toFixed(0)}% of realized revenue
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
