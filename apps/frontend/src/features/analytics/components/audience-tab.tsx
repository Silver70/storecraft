import { useSuspenseQuery } from "@tanstack/react-query";
import {
  UsersIcon,
  MonitorSmartphoneIcon,
  GlobeIcon,
  AppWindowIcon,
  LaptopIcon,
} from "lucide-react";
import { Flag } from "~/components/ui/flag";
import type { Period, AudienceAnalytics } from "~/types/api";
import { audienceAnalyticsQueryOptions } from "../queries";
import { num, series } from "../utils";
import { MetricTile } from "./metric-tile";
import { DonutChart, type DonutSlice } from "./donut-chart";
import { BarChartCard } from "./bar-chart-card";
import { RankedBarList } from "./ranked-bar-list";

const REGION = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code: string): string {
  try {
    return REGION.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function AudienceTab({ period }: { period: Period }) {
  const data: AudienceAnalytics = useSuspenseQuery(
    audienceAnalyticsQueryOptions(period),
  ).data;

  // Devices are distinct things, not a ranking — the one place categorical
  // colour belongs, assigned in fixed slot order.
  const deviceSlices: DonutSlice[] = data.devices.map((d, i) => ({
    name: d.label,
    value: d.sessions,
    color: series(i),
  }));

  const topDevice = data.devices[0]?.label ?? "—";
  const topCountry = data.countries[0]
    ? countryName(data.countries[0].countryCode)
    : "—";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricTile
          label="Sessions"
          value={num(data.totalSessions)}
          icon={UsersIcon}
          hint="Bots excluded"
        />
        <MetricTile
          label="Top device"
          value={topDevice}
          icon={MonitorSmartphoneIcon}
        />
        <MetricTile label="Top country" value={topCountry} icon={GlobeIcon} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutChart
          title="Devices"
          description="Sessions by device type"
          icon={MonitorSmartphoneIcon}
          data={deviceSlices}
          centerValue={num(data.totalSessions)}
          centerLabel="sessions"
          emptyLabel="No sessions yet"
          emptyDetail="Device type is detected automatically once visitors arrive."
        />
        <RankedBarList
          title="Countries"
          description="Sessions by country"
          icon={GlobeIcon}
          emptyLabel="No location data yet"
          emptyDetail="Country is resolved at the edge — it appears as soon as traffic comes through your CDN."
          items={data.countries.map((c) => ({
            label: countryName(c.countryCode),
            icon: <Flag code={c.countryCode} className="text-base" />,
            value: num(c.sessions),
            weight: c.sessions,
          }))}
        />
        <BarChartCard
          title="Browsers"
          description="Sessions by browser"
          icon={AppWindowIcon}
          valueLabel="Sessions"
          formatValue={num}
          maxLabel={12}
          emptyLabel="No browser data yet"
          data={data.browsers.map((b) => ({
            label: b.label,
            value: b.sessions,
          }))}
        />
        <BarChartCard
          title="Operating systems"
          description="Sessions by OS"
          icon={LaptopIcon}
          valueLabel="Sessions"
          formatValue={num}
          maxLabel={12}
          emptyLabel="No OS data yet"
          data={data.operatingSystems.map((o) => ({
            label: o.label,
            value: o.sessions,
          }))}
        />
      </div>
    </div>
  );
}
