import { queryOptions } from "@tanstack/react-query";
import type { CampaignPeriod, Period } from "~/types/api";
import {
  getAdAccountsServerFn,
  getAdPlatformConnectionsServerFn,
  getAttributedRevenueServerFn,
  getCampaignByIdServerFn,
  getCampaignPerformanceServerFn,
  getCampaignsServerFn,
} from "./server";

export const campaignsQueryOptions = () =>
  queryOptions({
    queryKey: ["campaigns"],
    queryFn: () => getCampaignsServerFn(),
    staleTime: 30 * 1000,
  });

export const campaignQueryOptions = (campaignId: string) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId],
    queryFn: () => getCampaignByIdServerFn({ data: { campaignId } }),
    staleTime: 30 * 1000,
  });

export const campaignPerformanceQueryOptions = (
  campaignId: string,
  period: CampaignPeriod,
) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId, "performance", period],
    queryFn: () =>
      getCampaignPerformanceServerFn({ data: { campaignId, period } }),
    staleTime: 60 * 1000,
  });

export const attributedRevenueQueryOptions = (period: Period) =>
  queryOptions({
    queryKey: ["campaigns", "revenue", period],
    queryFn: () => getAttributedRevenueServerFn({ data: { period } }),
    staleTime: 60 * 1000,
  });

/**
 * What this store is connected to.
 *
 * The page cannot be drawn without it: before a connection there are no
 * campaigns to show, and after one the header says whose account the figures
 * below came from and when they were last confirmed.
 */
export const adPlatformConnectionsQueryOptions = () =>
  queryOptions({
    queryKey: ["campaigns", "connection"],
    queryFn: () => getAdPlatformConnectionsServerFn(),
    staleTime: 60 * 1000,
  });

/**
 * The ad accounts the approved login can see.
 *
 * Not cached for long, and refetched whenever the picker opens: an account's
 * standing is Meta's to change, and offering one that was closed this morning
 * sends a merchant to a failure instead of to a reason.
 */
export const adAccountsQueryOptions = () =>
  queryOptions({
    queryKey: ["campaigns", "connection", "ad-accounts"],
    queryFn: () => getAdAccountsServerFn({ data: { platform: "meta" } }),
    staleTime: 0,
  });
