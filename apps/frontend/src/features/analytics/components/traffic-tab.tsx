import { useSuspenseQuery } from "@tanstack/react-query";
import {
  UsersIcon,
  ShoppingBagIcon,
  PercentIcon,
  SparklesIcon,
  FilterIcon,
  RadioIcon,
  ExternalLinkIcon,
} from "lucide-react";
import type { Period, TrafficAnalytics } from "~/types/api";
import { trafficAnalyticsQueryOptions } from "../queries";
import { num } from "../utils";
import { MetricTile } from "./metric-tile";
import { FunnelChart } from "./funnel-chart";
import { BarChartCard } from "./bar-chart-card";
import { RankedBarList } from "./ranked-bar-list";

const TRACKER_HINT =
  "Add the tracker script to your storefront to start collecting visits.";

export function TrafficTab({ period }: { period: Period }) {
  const data: TrafficAnalytics = useSuspenseQuery(
    trafficAnalyticsQueryOptions(period),
  ).data;

  const aiSessions =
    data.sources.find((s) => s.channel === "AI Assistant")?.sessions ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Unique visitors"
          value={num(data.uniqueVisitors)}
          icon={UsersIcon}
        />
        <MetricTile
          label="Orders"
          value={num(data.orders)}
          icon={ShoppingBagIcon}
        />
        <MetricTile
          label="Conversion rate"
          value={`${data.trueConversionRatePct}%`}
          icon={PercentIcon}
          hint="Orders ÷ unique visitors"
        />
        <MetricTile
          label="AI assistant"
          value={num(aiSessions)}
          icon={SparklesIcon}
          hint="Visits from ChatGPT, Perplexity and similar"
        />
      </div>

      <FunnelChart
        title="Conversion funnel"
        description="Distinct sessions reaching each stage"
        icon={FilterIcon}
        stages={data.funnel}
        emptyLabel="No visits yet for this period"
        emptyDetail={TRACKER_HINT}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarChartCard
          title="Traffic sources"
          description="Sessions by first-touch channel"
          icon={RadioIcon}
          valueLabel="Sessions"
          formatValue={num}
          maxLabel={16}
          emptyLabel="No visits yet for this period"
          emptyDetail={TRACKER_HINT}
          data={data.sources.map((s) => ({
            label: s.channel,
            value: s.sessions,
          }))}
        />
        <RankedBarList
          title="Top referrers"
          description="Sessions by referring site"
          icon={ExternalLinkIcon}
          emptyLabel="No referred visits yet"
          emptyDetail="Referrers appear when someone reaches your store from another site."
          items={data.topReferrers.map((r) => ({
            label: r.referrer,
            value: num(r.sessions),
            weight: r.sessions,
          }))}
        />
      </div>
    </div>
  );
}
