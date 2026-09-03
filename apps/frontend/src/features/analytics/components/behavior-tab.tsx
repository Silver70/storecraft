import {
  FileTextIcon,
  LogInIcon,
  MousePointerClickIcon,
  SendIcon,
} from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { Period, BehaviorAnalytics } from "~/types/api";
import { behaviorAnalyticsQueryOptions } from "../queries";
import { num } from "../utils";
import { RankedBarList } from "./ranked-bar-list";

export function BehaviorTab({ period }: { period: Period }) {
  const data: BehaviorAnalytics = useSuspenseQuery(
    behaviorAnalyticsQueryOptions(period),
  ).data;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RankedBarList
        title="Top pages"
        description="Views and unique visitors"
        icon={FileTextIcon}
        emptyLabel="No page views yet"
        emptyDetail="Page views start arriving as soon as the tracker is on your storefront."
        items={data.topPages.map((p) => ({
          label: p.path,
          sublabel: `${num(p.visitors)} visitors`,
          value: num(p.views),
          weight: p.views,
        }))}
      />
      <RankedBarList
        title="Landing pages"
        description="First page of each session"
        icon={LogInIcon}
        emptyLabel="No landing pages yet"
        emptyDetail="This shows where visitors arrive first, once traffic comes in."
        items={data.entryPages.map((p) => ({
          label: p.path,
          value: num(p.sessions),
          weight: p.sessions,
        }))}
      />
      <RankedBarList
        title="Top clicks"
        description="Tracked element clicks"
        icon={MousePointerClickIcon}
        emptyLabel="No clicks tracked yet"
        emptyDetail="Click tracking is opt-in — turn on autocapture, or mark the elements you care about."
        items={data.topClicks.map((c) => ({
          label: c.label,
          value: num(c.count),
          weight: c.count,
        }))}
      />
      <RankedBarList
        title="Form submissions"
        description="Submissions by form"
        icon={SendIcon}
        emptyLabel="No form submissions yet"
        emptyDetail="Form tracking is opt-in — turn on autocapture, or mark the forms you care about."
        items={data.forms.map((f) => ({
          label: f.name,
          value: num(f.submissions),
          weight: f.submissions,
        }))}
      />
    </div>
  );
}
