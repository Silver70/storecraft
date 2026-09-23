import { queryOptions } from "@tanstack/react-query";
import type {
  AdStatus,
  AttributionTouch,
  CampaignStatus,
  Period,
} from "~/types/api";
import {
  getCampaignAdsServerFn,
  getAttributedRevenueServerFn,
  getCampaignByIdServerFn,
  getCampaignRulesServerFn,
  getCampaignsServerFn,
} from "./server";

type ListStatus = CampaignStatus | "all";

export const campaignsQueryOptions = (status: ListStatus = "active") =>
  queryOptions({
    queryKey: ["campaigns", status],
    queryFn: () => getCampaignsServerFn({ data: { status } }),
    staleTime: 30 * 1000,
  });

export const campaignQueryOptions = (campaignId: string) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId],
    queryFn: () => getCampaignByIdServerFn({ data: { campaignId } }),
    staleTime: 30 * 1000,
  });

export const campaignRulesQueryOptions = (campaignId: string) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId, "rules"],
    queryFn: () => getCampaignRulesServerFn({ data: { campaignId } }),
    staleTime: 30 * 1000,
  });

/**
 * The creatives running under one campaign.
 *
 * Active only by default — an archived ad is a finished creative, and keeping it
 * in the list would make every long-running campaign read as more cluttered than
 * it is. Keyed under the campaign so archiving one refreshes this list and
 * nothing else.
 */
export const campaignAdsQueryOptions = (
  campaignId: string,
  status: AdStatus | "all" = "active",
) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId, "ads", status],
    queryFn: () => getCampaignAdsServerFn({ data: { campaignId, status } }),
    staleTime: 30 * 1000,
  });

export const attributedRevenueQueryOptions = (
  period: Period,
  touch: AttributionTouch,
) =>
  queryOptions({
    queryKey: ["campaigns", "revenue", period, touch],
    queryFn: () => getAttributedRevenueServerFn({ data: { period, touch } }),
    staleTime: 60 * 1000,
  });
