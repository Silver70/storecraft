import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type {
  AttributionTouch,
  CampaignRuleField,
  CampaignRuleOperator,
  CampaignStatus,
  Period,
} from "~/types/api";
import {
  generateCampaignLinkServerFn,
  getAttributedRevenueServerFn,
  getCampaignByIdServerFn,
  getCampaignRulesServerFn,
  getCampaignSpendServerFn,
  getCampaignsServerFn,
  getMarketingSummaryServerFn,
  previewCampaignRuleServerFn,
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
 * What one campaign cost over a period.
 *
 * Short-lived on purpose: recording spend is the one thing on the campaign page
 * that changes money, and a merchant who has just typed a figure should see the
 * list and its total agree with what they typed.
 */
export const campaignSpendQueryOptions = (campaignId: string, period: Period) =>
  queryOptions({
    queryKey: ["campaigns", "detail", campaignId, "spend", period],
    queryFn: () => getCampaignSpendServerFn({ data: { campaignId, period } }),
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

/**
 * Blended spend, revenue and ROAS for a period — what the dashboard card shows.
 *
 * Keyed apart from the full report even though the backend derives one from the
 * other, so the dashboard's copy is not invalidated by the report page and vice
 * versa. `retry: false` because this query has a visible failure state: the card
 * says it could not load and the dashboard around it carries on, and three
 * silent retries would only make it say so a few seconds later.
 */
export const marketingSummaryQueryOptions = (
  period: Period,
  touch: AttributionTouch = "last",
) =>
  queryOptions({
    queryKey: ["campaigns", "summary", period, touch],
    queryFn: () => getMarketingSummaryServerFn({ data: { period, touch } }),
    staleTime: 60 * 1000,
    retry: false,
  });

/** A rule the merchant has typed but not saved. */
export type RulePreviewCandidate = {
  field: CampaignRuleField;
  operator: CampaignRuleOperator;
  value: string;
};

/**
 * What a candidate rule would claim, for a period.
 *
 * Only fetched once the merchant asks for it — a preview resolves every order
 * in the period against every rule in the store, which is not something to run
 * per keystroke. Passing `null` keeps it idle, which is also how the card
 * discards an answer the moment the rule it described is edited: a preview of a
 * rule you have since changed is worse than no preview.
 */
export const campaignRulePreviewQueryOptions = (
  campaignId: string,
  candidate: RulePreviewCandidate | null,
  period: Period,
  touch: AttributionTouch,
) =>
  queryOptions({
    queryKey: [
      "campaigns",
      "detail",
      campaignId,
      "rule-preview",
      period,
      touch,
      candidate,
    ],
    queryFn: () =>
      previewCampaignRuleServerFn({
        data: {
          campaignId,
          field: candidate!.field,
          operator: candidate!.operator,
          value: candidate!.value,
          period,
          touch,
        },
      }),
    enabled: candidate !== null,
    staleTime: 60 * 1000,
    retry: false,
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
