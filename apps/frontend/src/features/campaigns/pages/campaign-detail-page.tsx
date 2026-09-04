import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { CAMPAIGN_PLATFORMS, type Campaign, type CampaignPlatform } from "~/types/api";
import { ArchiveCampaignButton } from "../components/archive-campaign-button";
import { CampaignFields } from "../components/campaign-fields";
import { CampaignSpendCard } from "../components/campaign-spend-card";
import { CampaignStatusBadge } from "../components/campaign-status-badge";
import { CopyButton } from "../components/copy-button";
import { MatchingRulesCard } from "../components/matching-rules-card";
import { TaggedLinkCard } from "../components/tagged-link-card";
import { campaignQueryOptions } from "../queries";
import { updateCampaignServerFn } from "../server";

const updateCampaignSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    platform: z.enum(CAMPAIGN_PLATFORMS),
    externalId: z.string().max(255).optional(),
});

const route = getRouteApi("/admin/campaigns_/$campaignId");

export function CampaignDetailPage() {
    const { campaignId } = route.useParams();
    const queryClient = useQueryClient();

    const campaign: Campaign = useSuspenseQuery(campaignQueryOptions(campaignId)).data;

    const [name, setName] = React.useState(campaign.name);
    const [platform, setPlatform] = React.useState<CampaignPlatform>(campaign.platform);
    const [externalId, setExternalId] = React.useState(campaign.externalId ?? "");
    const [errors, setErrors] = React.useState<Record<string, string>>({});
    const [saved, setSaved] = React.useState(false);

    const dirty =
        name !== campaign.name || platform !== campaign.platform || externalId !== (campaign.externalId ?? "");

    const updateMutation = useMutation({
        mutationFn: () => {
            const result = updateCampaignSchema.safeParse({
                name: name.trim(),
                platform,
                externalId: externalId.trim() || undefined,
            });
            if (!result.success) {
                const fieldErrors: Record<string, string> = {};
                for (const issue of result.error.issues) {
                    fieldErrors[issue.path.join(".")] = issue.message;
                }
                setErrors(fieldErrors);
                throw new Error("Validation failed");
            }
            setErrors({});
            return updateCampaignServerFn({
                data: {
                    campaignId,
                    // Sent as an empty string when cleared, which the backend reads as null.
                    externalId: result.data.externalId ?? "",
                    name: result.data.name,
                    platform: result.data.platform,
                },
            });
        },
        onSuccess: () => {
            setSaved(true);
            queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        },
        onError: err => {
            if (err.message !== "Validation failed") {
                setErrors({
                    _root: err instanceof Error ? err.message : "Failed to update campaign",
                });
            }
        },
    });

    React.useEffect(() => {
        if (!saved) return;
        const timer = setTimeout(() => setSaved(false), 2000);
        return () => clearTimeout(timer);
    }, [saved]);

    return (
        <div className="space-y-6 pb-10">
            {/* ── Header ────────────────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-4">
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

                <div className="flex items-center gap-3">
                    {errors._root && <p className="text-xs text-destructive">{errors._root}</p>}
                    {saved && !dirty && <p className="text-xs text-muted-foreground">Saved</p>}
                    <Button
                        disabled={!dirty || updateMutation.isPending}
                        onClick={() => updateMutation.mutate()}
                        className="px-5"
                    >
                        {updateMutation.isPending ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                </div>
            </div>

            <div className="mx-auto max-w-2xl space-y-5">
                {/* ── Details ───────────────────────────────────────────────────────── */}
                <Card>
                    <CardHeader className="border-b pb-4">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Campaign Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-5">
                        <CampaignFields
                            name={name}
                            onNameChange={setName}
                            platform={platform}
                            onPlatformChange={setPlatform}
                            externalId={externalId}
                            onExternalIdChange={setExternalId}
                            errors={errors}
                        />
                    </CardContent>
                </Card>

                {/* ── Canonical tag ─────────────────────────────────────────────────── */}
                <Card>
                    <CardHeader className="border-b pb-4">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Campaign Tag
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-5">
                        <Label>utm_campaign</Label>
                        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                            <code className="min-w-0 flex-1 truncate font-mono text-sm">{campaign.tag}</code>
                            <CopyButton value={campaign.tag} label="tag" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Any visit arriving with this <code>utm_campaign</code> value is attributed here. The tag is
                            fixed when the campaign is created and does not change if you rename it, so links already
                            running in an ad platform keep working.
                        </p>
                    </CardContent>
                </Card>

                {/* ── Tagged links ──────────────────────────────────────────────────── */}
                <TaggedLinkCard campaign={campaign} />

                {/* ── Matching rules ────────────────────────────────────────────────── */}
                <MatchingRulesCard campaignId={campaignId} />

                {/* ── Spend ─────────────────────────────────────────────────────────── */}
                <CampaignSpendCard campaignId={campaignId} />

                {/* ── Retire ────────────────────────────────────────────────────────── */}
                <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                        {campaign.status === "archived"
                            ? "Archived campaigns stay out of the active list and keep explaining the orders they drove."
                            : "Finished with this campaign? Archiving hides it without losing its history."}
                    </p>
                    <ArchiveCampaignButton campaign={campaign} />
                </div>
            </div>
        </div>
    );
}
