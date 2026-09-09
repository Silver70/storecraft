import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { LinkIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { useDebouncedValue } from "~/lib/use-debounced-value";
import type { CampaignPlatform } from "~/types/api";
import { campaignLinkQueryOptions } from "../queries";
import { PLATFORM_LINK_DEFAULTS } from "../utils";
import { CopyButton } from "./copy-button";

/**
 * The link that makes an ad measurable, one click from the ad that needs it.
 *
 * This is the single point where per-ad reporting can silently fail. Per-ad
 * spend can eventually be synced from a platform; per-ad *revenue* cannot —
 * only a link carrying the ad tag joins a platform's creative to our orders. A
 * merchant who does not tag `utm_content` gets cost against unassigned revenue
 * and an ad that looks like it earned nothing, and nothing in the data says
 * why. So the fix is put beside the symptom rather than a navigation away.
 *
 * Neither tag is typed. `utm_campaign` comes from the campaign and
 * `utm_content` from the ad, so a link built here is attributed at both levels
 * by construction — which is the property that makes the card beneath it mean
 * anything.
 */
export function AdTaggedLink({
  campaignId,
  platform,
  adName,
  adTag,
}: {
  campaignId: string;
  platform: CampaignPlatform;
  adName: string;
  adTag: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Tagged link
        </Button>
      </PopoverTrigger>
      {/* Radix mounts this only while open, which is what keeps a grid of forty
          ads from firing forty link requests on load. */}
      <PopoverContent align="start" className="w-88">
        <LinkBuilder
          campaignId={campaignId}
          platform={platform}
          adName={adName}
          adTag={adTag}
        />
      </PopoverContent>
    </Popover>
  );
}

function LinkBuilder({
  campaignId,
  platform,
  adName,
  adTag,
}: {
  campaignId: string;
  platform: CampaignPlatform;
  adName: string;
  adTag: string;
}) {
  const defaults = PLATFORM_LINK_DEFAULTS[platform];

  const [choices, setChoices] = React.useState({
    destination: "",
    source: defaults.source,
    medium: defaults.medium,
    // Fixed, and not offered as a field. A merchant free to edit this could
    // point the link at a creative that does not exist, which reports as
    // unassigned and looks like an ad that sold nothing.
    content: adTag,
  });

  const [debounced, settling] = useDebouncedValue(choices, 350);
  const { data: link, error } = useQuery(
    campaignLinkQueryOptions(campaignId, debounced),
  );

  const ready =
    debounced.source.trim().length > 0 && debounced.medium.trim().length > 0;

  const set = (field: "destination" | "source" | "medium") => (value: string) =>
    setChoices((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-3">
      <PopoverHeader>
        <PopoverTitle>Tagged link for {adName}</PopoverTitle>
        <PopoverDescription className="text-xs leading-relaxed">
          Carries this campaign&apos;s tag and{" "}
          <code className="font-mono">utm_content={adTag}</code>, so what
          arrives through it is credited to this ad and not to unassigned.
        </PopoverDescription>
      </PopoverHeader>

      <div className="space-y-1.5">
        <Label htmlFor={`link-destination-${adTag}`} className="text-xs">
          Destination
        </Label>
        <Input
          id={`link-destination-${adTag}`}
          className="h-8"
          placeholder="/products/summer-tee"
          value={choices.destination}
          onChange={(e) => set("destination")(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`link-source-${adTag}`} className="text-xs">
            Source
          </Label>
          <Input
            id={`link-source-${adTag}`}
            className="h-8"
            placeholder="instagram"
            value={choices.source}
            onChange={(e) => set("source")(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`link-medium-${adTag}`} className="text-xs">
            Medium
          </Label>
          <Input
            id={`link-medium-${adTag}`}
            className="h-8"
            placeholder="paid-social"
            value={choices.medium}
            onChange={(e) => set("medium")(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="rounded-md border bg-muted/30 px-2.5 py-2">
          <code className="block break-all font-mono text-[11px] leading-relaxed">
            {!ready ? (
              <span className="text-muted-foreground">
                Fill in a source and a medium.
              </span>
            ) : error ? (
              <span className="text-destructive">{error.message}</span>
            ) : link ? (
              link.url
            ) : (
              <span className="text-muted-foreground">Generating…</span>
            )}
          </code>
        </div>
        <div className="flex items-center justify-end gap-2">
          {settling && ready && (
            <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <CopyButton
            value={link?.url ?? ""}
            label="tagged link"
            variant="outline"
            disabled={!link || !!error || !ready}
          >
            Copy link
          </CopyButton>
        </div>
      </div>
    </div>
  );
}
