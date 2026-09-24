import * as React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { Campaign, CampaignPeriod } from "~/types/api";
import { CampaignAdsTable } from "../components/campaign-ads-table";
import { CreativeTile } from "../components/campaign-cards";
import { CampaignStatusBadge } from "../components/campaign-status-badge";
import {
  AddAdButton,
  AdDeliveryToggle,
  CampaignDeliveryButton,
  CoverPickerButton,
  EditCampaignButton,
  EditNoticeBanner,
  type EditNotice,
} from "../components/campaign-edit";
import { metaConnection } from "../components/meta-connection";
import { PerformancePanel } from "../components/performance-panel";
import { StartTrackingBanner } from "../components/start-tracking";
import {
  adPlatformConnectionsQueryOptions,
  campaignFormContextQueryOptions,
  campaignPerformanceQueryOptions,
  campaignQueryOptions,
} from "../queries";
import {
  CAMPAIGN_PERIODS,
  defaultCampaignPeriod,
  formatFlight,
  formatPlatform,
} from "../utils";

const route = getRouteApi("/admin/campaigns_/$campaignId");

/**
 * One campaign: its cover, one performance panel, and the ads that ran under
 * it. Enough to answer "was this worth it, and which creative carried it"
 * without touching a control — the period picker is the only one, and the page
 * opens on a sensible period without it.
 *
 * Drawn entirely from what the sync already stored. Nothing here calls the ad
 * platform to render, so a vendor outage costs the page its freshness, never the
 * page. The calls out are the ones a merchant presses: Start tracking, and
 * the handful of edits a running campaign allows — pause and resume, a new
 * name, budget or end date, pausing one ad, adding one, and the cover. Each is
 * made at Meta first and shown here as soon as Meta accepts it. With Meta
 * disconnected the figures freeze and there is nothing to send an edit to, so
 * none is offered.
 */
export function CampaignDetailPage() {
  const { campaignId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();

  const campaign: Campaign = useSuspenseQuery(campaignQueryOptions(campaignId)).data;
  const period = search.period ?? defaultCampaignPeriod(campaign.status);
  const report = useSuspenseQuery(campaignPerformanceQueryOptions(campaignId, period)).data;
  const line = report.campaign;
  const connection = metaConnection(
    useSuspenseQuery(adPlatformConnectionsQueryOptions()).data,
  );
  const context = useSuspenseQuery(campaignFormContextQueryOptions()).data;
  const editable = connection?.status === "connected";
  const [notice, setNotice] = React.useState<EditNotice | null>(null);

  const schedule = formatFlight(line.startsAt, line.endsAt);

  const choosePeriod = (next: CampaignPeriod) =>
    navigate({
      // The default is left out of the URL, so a link to a campaign keeps
      // opening on whatever suits the campaign when it is followed.
      search: { period: next === defaultCampaignPeriod(campaign.status) ? undefined : next },
      replace: true,
      resetScroll: false,
    });

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <Link
          to="/admin/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Campaigns
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold">{line.name}</h1>
              <CampaignStatusBadge status={line.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {[`${formatPlatform(line.platform)} Ads`, schedule].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={period} onValueChange={(v) => choosePeriod(v as CampaignPeriod)}>
              <TabsList>
                {CAMPAIGN_PERIODS.map((p) => (
                  <TabsTrigger key={p.value} value={p.value} className="text-xs">
                    {p.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {editable && (
              <>
                <CampaignDeliveryButton
                  campaign={campaign}
                  currency={context.currency}
                  onNotice={setNotice}
                />
                <EditCampaignButton campaign={campaign} context={context} />
              </>
            )}
          </div>
        </div>
        {!editable && (
          <p className="text-xs text-muted-foreground">
            Meta isn’t connected to this store, so this campaign can’t be changed
            from here.
          </p>
        )}
      </div>

      {notice && <EditNoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}

      {/* A Tracked campaign has nothing to start, so it offers nothing. */}
      {!line.hasLinkTags && <StartTrackingBanner line={line} />}

      {/* ── Cover and performance ─────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="relative">
          <CreativeTile
            src={line.coverUrl}
            name={line.name}
            className="aspect-[4/3] h-auto w-full rounded-xl"
          />
          {editable && (
            <div className="absolute right-3 bottom-3">
              <CoverPickerButton
                campaignId={campaign.id}
                coverUrl={line.coverUrl}
                ads={line.ads}
              />
            </div>
          )}
        </div>
        <PerformancePanel line={line} lookbackDays={report.lookbackDays} />
      </div>

      {/* ── Ads ───────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ads
          </h2>
          {editable && <AddAdButton campaign={campaign} context={context} />}
        </div>
        <CampaignAdsTable
          line={line}
          action={
            editable
              ? (ad) => (
                  <AdDeliveryToggle campaignId={campaign.id} ad={ad} onNotice={setNotice} />
                )
              : undefined
          }
        />
      </section>
    </div>
  );
}
