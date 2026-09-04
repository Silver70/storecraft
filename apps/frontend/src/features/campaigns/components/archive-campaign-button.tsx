import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import type { Campaign } from "~/types/api";
import { archiveCampaignServerFn, unarchiveCampaignServerFn } from "../server";

/**
 * Archiving is the only way to retire a campaign — there is no delete. A
 * campaign explains orders that have already been reported, so removing it
 * would move that revenue into Unattributed after the fact.
 */
export function ArchiveCampaignButton({ campaign }: { campaign: Campaign }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const archived = campaign.status === "archived";

  const mutation = useMutation({
    mutationFn: () =>
      archived
        ? unarchiveCampaignServerFn({ data: { campaignId: campaign.id } })
        : archiveCampaignServerFn({ data: { campaignId: campaign.id } }),
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  if (archived) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? (
          <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArchiveRestoreIcon className="h-3.5 w-3.5" />
        )}
        Restore campaign
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setConfirming(true)}
      >
        <ArchiveIcon className="h-3.5 w-3.5" />
        Archive campaign
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Archive? Its history is kept.
      </span>
      <Button
        size="sm"
        className="h-7 px-3 text-xs"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? (
          <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          "Archive"
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-3 text-xs"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
