import { queryOptions } from "@tanstack/react-query";
import type { Period } from "~/types/api";
import {
  getAttributedRevenueServerFn,
  getCampaignAdsServerFn,
  getCampaignByIdServerFn,
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

export const campaignAdsQueryOptions = (campaignId: string) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId, "ads"],
    queryFn: () => getCampaignAdsServerFn({ data: { campaignId } }),
    staleTime: 30 * 1000,
  });

export const attributedRevenueQueryOptions = (period: Period) =>
  queryOptions({
    queryKey: ["campaigns", "revenue", period],
    queryFn: () => getAttributedRevenueServerFn({ data: { period } }),
    staleTime: 60 * 1000,
  });
