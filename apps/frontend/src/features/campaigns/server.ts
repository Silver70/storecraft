import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import {
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_RULE_FIELDS,
  CAMPAIGN_RULE_OPERATORS,
  type AttributedRevenueReport,
  type Campaign,
  type CampaignMatchingRule,
  type CampaignSpend,
  type CampaignSpendReport,
  type CampaignTaggedLink,
  type MarketingSummary,
  type RulePreviewReport,
} from "~/types/api";

async function storeHeaders() {
  return { ...(await authHeader()), ...adminStoreHeader() };
}

const platformSchema = z.enum(CAMPAIGN_PLATFORMS);

export const getCampaignsServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ status: z.enum(["active", "archived", "all"]).optional() }),
  )
  .handler(async ({ data }): Promise<Campaign[]> => {
    const params = new URLSearchParams();
    if (data.status) params.set("status", data.status);
    const query = params.toString();
    try {
      const res = await apiClient.get<Campaign[]>(
        `/api/admin/campaigns${query ? `?${query}` : ""}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const getCampaignByIdServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }): Promise<Campaign> => {
    try {
      const res = await apiClient.get<Campaign>(
        `/api/admin/campaigns/${data.campaignId}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const createCampaignServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1).max(255),
      platform: platformSchema,
      externalId: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }): Promise<Campaign> => {
    try {
      const res = await apiClient.post<Campaign>("/api/admin/campaigns", data, {
        headers: await storeHeaders(),
      });
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// The tag is deliberately absent: it is fixed at creation so that links already
// pasted into an ad platform keep matching the campaign they were generated for.
export const updateCampaignServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      name: z.string().min(1).max(255).optional(),
      platform: platformSchema.optional(),
      externalId: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }): Promise<Campaign> => {
    try {
      const { campaignId, ...body } = data;
      const res = await apiClient.patch<Campaign>(
        `/api/admin/campaigns/${campaignId}`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const archiveCampaignServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }): Promise<Campaign> => {
    try {
      const res = await apiClient.post<Campaign>(
        `/api/admin/campaigns/${data.campaignId}/archive`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const unarchiveCampaignServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }): Promise<Campaign> => {
    try {
      const res = await apiClient.post<Campaign>(
        `/api/admin/campaigns/${data.campaignId}/unarchive`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Matching rules ───────────────────────────────────────────────────────────

export const getCampaignRulesServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }): Promise<CampaignMatchingRule[]> => {
    try {
      const res = await apiClient.get<CampaignMatchingRule[]>(
        `/api/admin/campaigns/${data.campaignId}/rules`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const createCampaignRuleServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      field: z.enum(CAMPAIGN_RULE_FIELDS),
      operator: z.enum(CAMPAIGN_RULE_OPERATORS),
      value: z.string().min(1).max(255),
    }),
  )
  .handler(async ({ data }): Promise<CampaignMatchingRule> => {
    try {
      const { campaignId, ...body } = data;
      const res = await apiClient.post<CampaignMatchingRule>(
        `/api/admin/campaigns/${campaignId}/rules`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// The campaign's own tag rule is refused by the backend: every link generated
// from the campaign carries that tag, so removing it would unattribute ads
// already running.
export const deleteCampaignRuleServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      ruleId: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    try {
      await apiClient.delete(
        `/api/admin/campaigns/${data.campaignId}/rules/${data.ruleId}`,
        { headers: await storeHeaders() },
      );
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * What a candidate rule would claim, before it is saved.
 *
 * A read in the strictest sense — no rule is created and no report changes —
 * which is why it takes the same three fields the create call takes: previewing
 * a different rule than the one about to be posted would be worse than not
 * previewing at all.
 */
export const previewCampaignRuleServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      field: z.enum(CAMPAIGN_RULE_FIELDS),
      operator: z.enum(CAMPAIGN_RULE_OPERATORS),
      value: z.string().min(1).max(255),
      period: z.enum(["today", "7d", "30d", "90d"]),
      touch: z.enum(["first", "last"]),
    }),
  )
  .handler(async ({ data }): Promise<RulePreviewReport> => {
    const { campaignId, ...candidate } = data;
    const params = new URLSearchParams(candidate);
    try {
      const res = await apiClient.get<RulePreviewReport>(
        `/api/admin/campaigns/${campaignId}/rules/preview?${params.toString()}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Tagged links ─────────────────────────────────────────────────────────────

/**
 * The tagged URL for a campaign, composed by the backend.
 *
 * The campaign tag is not sent — it comes from the campaign being generated
 * for, which is the point: the one value matching depends on is never typed.
 * Composing the URL here instead would be a second implementation of it, free
 * to drift from the rule that claims the traffic.
 */
export const generateCampaignLinkServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      destination: z.string().max(1024).optional(),
      source: z.string().min(1).max(255),
      medium: z.string().min(1).max(255),
      content: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }): Promise<CampaignTaggedLink> => {
    const { campaignId, ...choices } = data;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(choices)) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    try {
      const res = await apiClient.get<CampaignTaggedLink>(
        `/api/admin/campaigns/${campaignId}/link?${params.toString()}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Attributed revenue ───────────────────────────────────────────────────────

/**
 * Revenue and order count per campaign for a period.
 *
 * Resolved on every read by running the store's matching rules over the touch
 * each order froze at checkout, which is why a campaign created after its ads
 * ran claims them and why adding a rule repairs history. The touch selector
 * chooses which of the two stored touches to credit; nothing is migrated.
 */
export const getAttributedRevenueServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      period: z.enum(["today", "7d", "30d", "90d"]),
      touch: z.enum(["first", "last"]),
    }),
  )
  .handler(async ({ data }): Promise<AttributedRevenueReport> => {
    try {
      const res = await apiClient.get<AttributedRevenueReport>(
        `/api/admin/marketing/attributed-revenue?period=${data.period}&touch=${data.touch}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * The same period as the report above, reduced to the figures on the dashboard
 * card.
 *
 * A separate request rather than a slice of the report, because the dashboard
 * asks for it and must not be taken down if it fails. The backend derives every
 * figure from the report itself, so this is a smaller answer to the same
 * question and never a second one.
 */
export const getMarketingSummaryServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      period: z.enum(["today", "7d", "30d", "90d"]),
      touch: z.enum(["first", "last"]).optional(),
    }),
  )
  .handler(async ({ data }): Promise<MarketingSummary> => {
    const params = new URLSearchParams({ period: data.period });
    if (data.touch) params.set("touch", data.touch);
    try {
      const res = await apiClient.get<MarketingSummary>(
        `/api/admin/marketing/summary?${params.toString()}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Campaign spend ───────────────────────────────────────────────────────────

/**
 * What a campaign cost over a period, plus the store's currency and today's
 * date where the store is.
 *
 * Those last two are read from the backend rather than derived here on purpose:
 * a date picker capped by the browser's clock would refuse a legitimate figure
 * for a merchant who is travelling, and offer an impossible one for a store
 * ahead of them.
 */
export const getCampaignSpendServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      period: z.enum(["today", "7d", "30d", "90d"]),
    }),
  )
  .handler(async ({ data }): Promise<CampaignSpendReport> => {
    try {
      const res = await apiClient.get<CampaignSpendReport>(
        `/api/admin/campaigns/${data.campaignId}/spend?period=${data.period}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Records one day's spend.
 *
 * A correction, not an addition: the backend upserts on `(campaign, day)`, so
 * submitting the same day twice leaves one row holding the last amount. That is
 * what makes a double-click harmless — an insert would double the day's cost
 * and halve the campaign's ROAS without anything failing.
 */
export const recordCampaignSpendServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
      amount: z.number().int().min(0),
      currency: z.string().length(3),
      note: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }): Promise<CampaignSpend> => {
    try {
      const { campaignId, ...body } = data;
      const res = await apiClient.post<CampaignSpend>(
        `/api/admin/campaigns/${campaignId}/spend`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Records one total across a range of days, as one row per day.
 *
 * For a merchant who knows what a week cost but not what each day cost. The
 * split is the backend's: it divides the total in minor units and adds the
 * remainder to the first day, so the rows sum to exactly the total typed.
 * Doing that arithmetic here as well would be a second implementation of it,
 * free to drift from the one that writes the rows.
 *
 * A correction like single-day entry — every day in the range is overwritten
 * rather than added to, so re-running an overlapping range repairs those days
 * instead of doubling them.
 */
export const recordCampaignSpendRangeServerFn = createServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
      endDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
      total: z.number().int().min(0),
      currency: z.string().length(3),
      note: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }): Promise<CampaignSpend[]> => {
    try {
      const { campaignId, ...body } = data;
      const res = await apiClient.post<CampaignSpend[]>(
        `/api/admin/campaigns/${campaignId}/spend/range`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// The day is deliberately absent: moving a figure to another day is recording
// it there — which corrects that day — and deleting the row entered by mistake.
// The currency is the store's and frozen on the row.
export const updateCampaignSpendServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      spendId: z.string().min(1),
      amount: z.number().int().min(0).optional(),
      note: z.string().max(255).optional(),
    }),
  )
  .handler(async ({ data }): Promise<CampaignSpend> => {
    try {
      const { campaignId, spendId, ...body } = data;
      const res = await apiClient.patch<CampaignSpend>(
        `/api/admin/campaigns/${campaignId}/spend/${spendId}`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const deleteCampaignSpendServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      spendId: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    try {
      await apiClient.delete(
        `/api/admin/campaigns/${data.campaignId}/spend/${data.spendId}`,
        { headers: await storeHeaders() },
      );
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });
