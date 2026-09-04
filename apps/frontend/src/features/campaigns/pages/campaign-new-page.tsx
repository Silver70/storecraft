import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CAMPAIGN_PLATFORMS, type CampaignPlatform } from "~/types/api";
import { createCampaignServerFn } from "../server";
import { CampaignFields } from "../components/campaign-fields";

const createCampaignSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  platform: z.enum(CAMPAIGN_PLATFORMS),
  externalId: z.string().max(255).optional(),
});

export function CampaignNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState<CampaignPlatform>("meta");
  const [externalId, setExternalId] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const canSave = name.trim().length > 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = createCampaignSchema.safeParse({
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
      return createCampaignServerFn({ data: result.data });
    },
    onSuccess: (campaign) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      // Straight to the detail page: the tag is assigned server-side, and it is
      // the thing the merchant needs next to tag their links.
      navigate({
        to: "/admin/campaigns/$campaignId",
        params: { campaignId: campaign.id },
      });
    },
    onError: (err) => {
      if (err.message !== "Validation failed") {
        setErrors({
          _root:
            err instanceof Error ? err.message : "Failed to create campaign",
        });
      }
    },
  });

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link
            to="/admin/campaigns"
            className="flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Campaigns
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" />
          <span className="text-foreground">Create campaign</span>
        </div>

        <div className="flex items-center gap-3">
          {errors._root && (
            <p className="text-xs text-destructive">{errors._root}</p>
          )}
          <Button
            disabled={!canSave || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="px-5"
          >
            {createMutation.isPending ? (
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-5">
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Campaign Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <CampaignFields
              name={name}
              onNameChange={setName}
              platform={platform}
              onPlatformChange={setPlatform}
              externalId={externalId}
              onExternalIdChange={setExternalId}
              errors={errors}
            />
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Saving assigns a tag derived from the name. Links carrying that
              tag are attributed to this campaign automatically — you don't have
              to set up any matching for it.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
