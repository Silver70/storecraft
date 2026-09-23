import { Badge } from "~/components/ui/badge";
import type { CampaignStatus } from "~/types/api";
import { STATUS_LABELS } from "../utils";

const CAMPAIGN_STATUS_STYLES: Record<CampaignStatus, string> = {
  active:
    "text-emerald-700 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400",
  paused: "text-muted-foreground border-border bg-muted/40",
  in_review:
    "text-sky-700 border-sky-200 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-900/50 dark:text-sky-400",
  needs_attention:
    "text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400",
  ended: "text-muted-foreground border-border bg-muted/40",
};

/** The platform's status, collapsed to five values. Never set here. */
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge
      variant="outline"
      className={`px-2 py-0 text-[11px] font-medium ${CAMPAIGN_STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}
