import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useDebouncedValue } from "~/lib/use-debounced-value";
import type { Campaign } from "~/types/api";
import { campaignLinkQueryOptions, type CampaignLinkChoices } from "../queries";
import { PLATFORM_LINK_DEFAULTS } from "../utils";
import { CopyButton } from "./copy-button";

/**
 * The tagged link a merchant pastes into an ad platform.
 *
 * The campaign tag is not one of the fields: it comes from the campaign, which
 * is the entire point — the one value attribution depends on is never typed, so
 * traffic through a generated link is claimed by the campaign's own rule with
 * nothing authored by hand. Everything else is the merchant's choice, and the
 * URL is composed by the backend so there is only ever one implementation of it.
 *
 * The generator is a convenience, not a precondition: a link tagged by hand
 * before this campaign existed is still claimable by a matching rule.
 */
export function TaggedLinkCard({ campaign }: { campaign: Campaign }) {
  const defaults = PLATFORM_LINK_DEFAULTS[campaign.platform];

  const [choices, setChoices] = React.useState<CampaignLinkChoices>({
    destination: "",
    source: defaults.source,
    medium: defaults.medium,
    content: "",
  });

  // The link is regenerated as the merchant types; debouncing keeps that to one
  // request per pause rather than one per keystroke.
  const [debounced, settling] = useDebouncedValue(choices, 350);
  const { data: link, error } = useQuery(
    campaignLinkQueryOptions(campaign.id, debounced),
  );

  const ready =
    debounced.source.trim().length > 0 && debounced.medium.trim().length > 0;

  const set = (field: keyof CampaignLinkChoices) => (value: string) =>
    setChoices((prev) => ({ ...prev, [field]: value }));

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tagged Link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <p className="text-xs text-muted-foreground">
          Build the URL to paste into an ad platform. It carries this campaign's{" "}
          <code>{campaign.tag}</code> tag, so everything that arrives through it
          is attributed here — no rule to write, no UTM string to type
          correctly.
        </p>

        {/* ── Choices ─────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label htmlFor="link-destination">Destination</Label>
          <Input
            id="link-destination"
            placeholder="/products/summer-tee"
            value={choices.destination}
            onChange={(e) => set("destination")(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Any page of your store — leave it empty for the home page. A full{" "}
            <code>https://</code> URL works too, for a store on its own domain.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="link-source">
              Source <span className="text-destructive">*</span>
            </Label>
            <Input
              id="link-source"
              placeholder="instagram"
              value={choices.source}
              onChange={(e) => set("source")(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Where the link is placed.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="link-medium">
              Medium <span className="text-destructive">*</span>
            </Label>
            <Input
              id="link-medium"
              placeholder="paid_social"
              value={choices.medium}
              onChange={(e) => set("medium")(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The kind of placement.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="link-content">Creative label (optional)</Label>
          <Input
            id="link-content"
            placeholder="video-a"
            value={choices.content}
            onChange={(e) => set("content")(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Added as <code>utm_content</code>, for telling two creatives in this
            campaign apart.
          </p>
        </div>

        {/* ── The link ────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label>Generated link</Label>
          <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">
              {!ready ? (
                <span className="text-muted-foreground">
                  Fill in a source and a medium to generate a link.
                </span>
              ) : error ? (
                <span className="text-destructive">{error.message}</span>
              ) : link ? (
                link.url
              ) : (
                <span className="text-muted-foreground">Generating…</span>
              )}
            </code>
            {settling && ready && (
              <LoaderCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            <CopyButton
              value={link?.url ?? ""}
              label="link"
              variant="outline"
              disabled={!link || !!error || !ready}
            >
              Copy link
            </CopyButton>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Source and medium are lower-cased with spacing turned into hyphens, so
          the link stays clean; matching ignores those differences anyway.
          Generate as many links as you have placements — they differ by source
          and medium, carry the same tag, and all report as this one campaign.
        </p>
      </CardContent>
    </Card>
  );
}
