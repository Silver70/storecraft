import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { Ad, Campaign } from "~/types/api";
import { CreativeTile } from "../components/campaign-cards";
import { CampaignStatusBadge } from "../components/campaign-status-badge";
import { campaignAdsQueryOptions, campaignQueryOptions } from "../queries";
import { formatAdFormat, formatFlight, formatPlatform } from "../utils";

const route = getRouteApi("/admin/campaigns_/$campaignId");

/**
 * One campaign as the ad platform describes it, and the ads under it.
 *
 * Read-only: the name, schedule, status and creatives are the platform's, and
 * change here only by asking the platform to change them.
 */
export function CampaignDetailPage() {
    const { campaignId } = route.useParams();

    const campaign: Campaign = useSuspenseQuery(campaignQueryOptions(campaignId)).data;
    const ads: Ad[] = useSuspenseQuery(campaignAdsQueryOptions(campaignId)).data;

    const schedule = formatFlight(campaign.startsAt, campaign.endsAt);

    return (
        <div className="space-y-6 pb-10">
            {/* ── Header ────────────────────────────────────────────────────────────── */}
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Link
                    to="/admin/campaigns"
                    className="flex items-center gap-1 transition-colors hover:text-foreground"
                >
                    <ArrowLeftIcon className="h-3.5 w-3.5" />
                    Campaigns
                </Link>
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-foreground">{campaign.name}</span>
                <CampaignStatusBadge status={campaign.status} />
            </div>

            <div className="mx-auto max-w-2xl space-y-5">
                {/* ── Details ───────────────────────────────────────────────────────── */}
                <Card>
                    <CardHeader className="border-b pb-4">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Campaign
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex gap-4 pt-5">
                        <CreativeTile src={campaign.coverUrl} name={campaign.name} />
                        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div>
                                <dt className="text-xs text-muted-foreground">Platform</dt>
                                <dd>{formatPlatform(campaign.platform)} Ads</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-muted-foreground">Schedule</dt>
                                <dd>{schedule ?? "—"}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-muted-foreground">Campaign id</dt>
                                <dd className="truncate font-mono text-xs">{campaign.externalId}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-muted-foreground">Revenue tracking</dt>
                                <dd>{campaign.hasLinkTags ? "Tracked" : "Not tracked"}</dd>
                            </div>
                        </dl>
                    </CardContent>
                </Card>

                {/* ── Ads ───────────────────────────────────────────────────────────── */}
                <Card>
                    <CardHeader className="border-b pb-4">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Ads
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5">
                        {ads.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No ads on this campaign.</p>
                        ) : (
                            <ul className="divide-y">
                                {ads.map(ad => (
                                    <li key={ad.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                                        <CreativeTile src={ad.creativeUrl} name={ad.name} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{ad.name}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {[formatAdFormat(ad.format), ad.hasLinkTags ? "Tracked" : "Not tracked"]
                                                    .filter(Boolean)
                                                    .join(" · ")}
                                            </p>
                                        </div>
                                        <CampaignStatusBadge status={ad.status} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
