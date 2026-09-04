import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { CAMPAIGN_PLATFORMS, type CampaignPlatform } from "~/types/api";
import { PLATFORM_LABELS } from "../utils";

/**
 * The three merchant-owned fields, shared by the create and edit forms so the
 * two can never drift apart. The canonical tag is not among them — it is derived
 * once at creation and shown read-only afterwards.
 */
export function CampaignFields({
  name,
  onNameChange,
  platform,
  onPlatformChange,
  externalId,
  onExternalIdChange,
  errors,
}: {
  name: string;
  onNameChange: (value: string) => void;
  platform: CampaignPlatform;
  onPlatformChange: (value: CampaignPlatform) => void;
  externalId: string;
  onExternalIdChange: (value: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="c-name">
          Campaign name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="c-name"
          placeholder="e.g. Summer Sale 2026"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-platform">
          Platform <span className="text-destructive">*</span>
        </Label>
        <Select
          value={platform}
          onValueChange={(value) => onPlatformChange(value as CampaignPlatform)}
        >
          <SelectTrigger id="c-platform" className="w-full">
            <SelectValue placeholder="Select a platform" />
          </SelectTrigger>
          <SelectContent>
            {CAMPAIGN_PLATFORMS.map((value) => (
              <SelectItem key={value} value={value}>
                {PLATFORM_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.platform && (
          <p className="text-xs text-destructive">{errors.platform}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-external-id">Ad platform ID</Label>
        <Input
          id="c-external-id"
          placeholder="Optional — the campaign's ID in the ad platform"
          value={externalId}
          onChange={(e) => onExternalIdChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Recorded so this campaign can be reconciled with the ad platform
          later.
        </p>
        {errors.externalId && (
          <p className="text-xs text-destructive">{errors.externalId}</p>
        )}
      </div>
    </div>
  );
}
