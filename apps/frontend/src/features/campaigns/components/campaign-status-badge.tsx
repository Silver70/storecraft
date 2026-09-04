import { Badge } from "~/components/ui/badge";
import type { CampaignStatus } from "~/types/api";

const CAMPAIGN_STATUS_STYLES: Record<CampaignStatus, string> = {
  active:
    "text-emerald-700 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400",
  archived: "text-muted-foreground border-border bg-muted/40",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge
      variant="outline"
      className={`px-2 py-0 text-[11px] font-medium capitalize ${CAMPAIGN_STATUS_STYLES[status]}`}
    >
      {status}
    </Badge>
  );
}
