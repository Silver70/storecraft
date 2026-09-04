import { queryOptions } from "@tanstack/react-query";
import type { CampaignStatus } from "~/types/api";
import {
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
