import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { AttributionTouch, CampaignStatus, Period } from "~/types/api";
import {
  generateCampaignLinkServerFn,
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

export const attributedRevenueQueryOptions = (
  period: Period,
  touch: AttributionTouch,
) =>
  queryOptions({
    queryKey: ["campaigns", "revenue", period, touch],
    queryFn: () => getAttributedRevenueServerFn({ data: { period, touch } }),
    staleTime: 60 * 1000,
  });

/** What the merchant chose for one tagged link. */
export type CampaignLinkChoices = {
  destination: string;
  source: string;
  medium: string;
  content: string;
};

/**
 * The tagged link for one set of choices.
 *
 * A link is derived from the campaign, never stored, so the same choices always
 * give the same URL and it can be cached indefinitely. Previous data is kept
 * while a new one loads so the box does not blink empty between keystrokes.
 */
export const campaignLinkQueryOptions = (
  campaignId: string,
  choices: CampaignLinkChoices,
) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId, "link", choices],
    queryFn: () =>
      generateCampaignLinkServerFn({
        data: {
          campaignId,
          destination: choices.destination.trim() || undefined,
          source: choices.source.trim(),
          medium: choices.medium.trim(),
          content: choices.content.trim() || undefined,
        },
      }),
    enabled:
      choices.source.trim().length > 0 && choices.medium.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
