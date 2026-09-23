import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, ImageIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatMoney } from "~/lib/money";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type {
  AdRevenueLine,
  Campaign,
  CampaignPlatform,
  CampaignRevenueLine,
  PerformanceFigures,
} from "~/types/api";
import { formatFlight, formatPlatform } from "../utils";
import { CampaignStatusBadge } from "./campaign-status-badge";
import { FigureList } from "./performance-figures";

/**
 * The picture a merchant recognises an ad by, since nobody recognises a slug.
 *
 * Display only — uploading and replacing belong on the campaign page, where the
 * ad is managed. What matters here is the empty state, which is the majority
 * state and permanently so for campaigns on email, SMS, affiliate, influencer
 * and other: it is drawn as a deliberate tile rather than as a hole where a
 * picture failed to load, because a grid of them is what most merchants will
 * see for months. A creative whose URL 404s falls back to the same tile, so the
 * one thing that cannot appear is a broken image.
 */
function CreativeTile({
  creativeUrl,
  name,
  dimmed,
}: {
  creativeUrl: string | null;
  name: string;
  dimmed?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [creativeUrl]);

  const showing = creativeUrl && !failed;

  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md",
        showing
          ? "border border-border/60"
          : "border-2 border-dashed border-border bg-muted/30 text-muted-foreground/60",
        dimmed && "opacity-60",
      )}
    >
      {showing ? (
        <img
          src={creativeUrl}
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

/**
 * A campaign, with what the period says about it.
 *
 * Wide rather than square, and above its ads rather than among them: it is the
 * thing that gets funded, and its figures are the total the split beneath it
 * has to add back up to.
 */
function CampaignCard({
  campaign,
  line,
  lookbackDays,
}: {
  campaign: Campaign;
  line: CampaignRevenueLine | null;
  lookbackDays: number;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/campaigns/$campaignId"
              params={{ campaignId: campaign.id }}
              className="truncate text-base font-semibold leading-none hover:underline"
            >
              {campaign.name}
            </Link>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <code className="font-mono">{campaign.tag}</code>
            <span aria-hidden>·</span>
            <span>{formatPlatform(campaign.platform)}</span>
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link
            to="/admin/campaigns/$campaignId"
            params={{ campaignId: campaign.id }}
          >
            Manage
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="border-t bg-muted/10 px-5 py-4">
        {line ? (
          <FigureList line={line} lookbackDays={lookbackDays} layout="row" />
        ) : (
          // Not a row of zeroes. The report leaves an archived campaign with
          // nothing in the window off the page entirely; showing zeroes here
          // would be making a claim about the period that nothing measured.
          <p className="text-xs text-muted-foreground">
            No revenue in this period. Its figures are wherever its orders were
            placed.
          </p>
        )}
      </div>
    </Card>
  );
}

/** One creative, with the figures that are its own and not the campaign's. */
function AdCard({
  platform,
  ad,
  lookbackDays,
}: {
  platform: CampaignPlatform;
  ad: AdRevenueLine;
  lookbackDays: number;
}) {
  const archived = ad.status === "archived";
  const flight = formatFlight(ad.startsAt, ad.endsAt);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <CreativeTile
          creativeUrl={ad.creativeUrl}
          name={ad.name}
          dimmed={archived}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "truncate text-sm font-medium leading-none",
                archived && "text-muted-foreground",
              )}
            >
              {ad.name}
            </p>
          </div>
          <code className="mt-1 block truncate font-mono text-xs text-muted-foreground">
            {ad.tag}
          </code>
          {/* Platform is inherited from the campaign — funding is per ad
              account — and the flight dates are the ad's own, so a three-day
              test is not read naively against a month-long evergreen. */}
          <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
            {formatPlatform(platform)}
            {flight ? ` · ${flight}` : ""}
            {archived ? " · Archived" : ""}
          </p>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <FigureList line={ad} lookbackDays={lookbackDays} />
      </div>
    </Card>
  );
}

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * What this campaign earned that none of its ads claimed.
 *
 * Prominent rather than tidy, and never redistributed across the ads above it.
 * The failure this card exists to make visible has no other symptom: a merchant
 * who forgets to tag `utm_content` inside the ad platform gets an ad that looks
 * like it earned nothing and a pile of revenue here, and the two facts only
 * mean something together. Spreading this across whichever creatives happen to
 * exist would flatter every one of them and hide the mistake completely.
 *
 * It is also not the same thing as unattributed at the store level: those
 * orders have no campaign at all, these have this one.
 */
function UnassignedCard({
  line,
  campaignRevenue,
  lookbackDays,
}: {
  line: PerformanceFigures;
  campaignRevenue: number;
  lookbackDays: number;
}) {
  const revenueShare = share(line.revenue, campaignRevenue);
  const notable = revenueShare >= 25;

  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden border-dashed py-0",
        notable && "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10",
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div
          className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-md border-2 border-dashed",
            notable
              ? "border-amber-500/40 text-amber-600 dark:text-amber-500"
              : "border-border text-muted-foreground/60",
          )}
        >
          <TriangleAlertIcon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-none">Unassigned</p>
          <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
            No ad tag on the link, or a tag no ad here owns.
          </p>
          {line.revenue > 0 && (
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
              {revenueShare.toFixed(0)}% of this campaign&apos;s revenue.
            </p>
          )}
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <FigureList line={line} lookbackDays={lookbackDays} />
      </div>
    </Card>
  );
}

/**
 * A campaign and its creatives, as one block.
 *
 * A campaign with no ads renders as the campaign card and nothing else — no
 * empty grid, no invitation to add one. An ad is a subdivision a merchant opts
 * into, and a campaign without one reports exactly as it did before ads
 * existed; nagging here would push merchants into a structure they have no data
 * for. The unassigned card appears only where there is a split for it to be the
 * residue of, since without ads it would just be the campaign line again.
 */
export function CampaignSection({
  campaign,
  line,
  lookbackDays,
}: {
  campaign: Campaign;
  line: CampaignRevenueLine | null;
  lookbackDays: number;
}) {
  const ads = line?.ads ?? [];

  return (
    <section aria-label={campaign.name} className="space-y-3">
      <CampaignCard
        campaign={campaign}
        line={line}
        lookbackDays={lookbackDays}
      />

      {line && ads.length > 0 && (
        <div className="grid gap-3 pl-0 sm:grid-cols-2 sm:pl-6 xl:grid-cols-3">
          {ads.map((ad) => (
            <AdCard
              key={ad.adId}
              platform={campaign.platform}
              ad={ad}
              lookbackDays={lookbackDays}
            />
          ))}
          <UnassignedCard
            line={line.unassigned}
            campaignRevenue={line.revenue}
            lookbackDays={lookbackDays}
          />
        </div>
      )}
    </section>
  );
}

/**
 * The revenue no campaign explains — direct arrivals, untagged links, and
 * touches older than the lookback window.
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
            No qualifying touch — direct arrivals, untagged links, and touches
            outside the lookback window.
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
