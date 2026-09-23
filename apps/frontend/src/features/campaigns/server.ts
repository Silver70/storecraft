import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import {
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_RULE_FIELDS,
  CAMPAIGN_RULE_OPERATORS,
  type Ad,
  type AttributedRevenueReport,
  type Campaign,
  type CampaignMatchingRule,
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

// ─── Ads ──────────────────────────────────────────────────────────────────────

// Addressed beneath the campaign throughout: an ad has no meaning outside one,
// and naming the campaign is what scopes both the lookup and the tag's
// uniqueness. An ad id from another organization does not resolve.

export const getCampaignAdsServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      status: z.enum(["active", "archived", "all"]).optional(),
    }),
  )
  .handler(async ({ data }): Promise<Ad[]> => {
    const params = new URLSearchParams();
    if (data.status) params.set("status", data.status);
    const query = params.toString();
    try {
      const res = await apiClient.get<Ad[]>(
        `/api/admin/campaigns/${data.campaignId}/ads${query ? `?${query}` : ""}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// A date input yields `YYYY-MM-DD`; the backend reads either that or a full
// ISO timestamp. `null` clears a date, which is different from omitting it.
const flightDateSchema = z.union([z.string().min(1), z.null()]).optional();

export const createCampaignAdServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      name: z.string().min(1).max(255),
      externalId: z.string().max(255).optional(),
      startsAt: flightDateSchema,
      endsAt: flightDateSchema,
    }),
  )
  .handler(async ({ data }): Promise<Ad> => {
    try {
      const { campaignId, ...body } = data;
      const res = await apiClient.post<Ad>(
        `/api/admin/campaigns/${campaignId}/ads`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// The tag is deliberately absent: it is fixed at creation so that a link already
// running in an ad platform keeps matching the ad it was generated for.
export const updateCampaignAdServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      adId: z.string().min(1),
      name: z.string().min(1).max(255).optional(),
      externalId: z.string().max(255).optional(),
      startsAt: flightDateSchema,
      endsAt: flightDateSchema,
    }),
  )
  .handler(async ({ data }): Promise<Ad> => {
    try {
      const { campaignId, adId, ...body } = data;
      const res = await apiClient.patch<Ad>(
        `/api/admin/campaigns/${campaignId}/ads/${adId}`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// There is no delete, by design: revenue already reported against an ad would be
// silently re-bucketed. Archiving is the only retirement path.
export const archiveCampaignAdServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ campaignId: z.string().min(1), adId: z.string().min(1) }),
  )
  .handler(async ({ data }): Promise<Ad> => {
    try {
      const res = await apiClient.post<Ad>(
        `/api/admin/campaigns/${data.campaignId}/ads/${data.adId}/archive`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// Always per ad and never a side effect of restoring the campaign: a merchant
// who retired creatives one by one must not have them all resurrected at once.
export const unarchiveCampaignAdServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ campaignId: z.string().min(1), adId: z.string().min(1) }),
  )
  .handler(async ({ data }): Promise<Ad> => {
    try {
      const res = await apiClient.post<Ad>(
        `/api/admin/campaigns/${data.campaignId}/ads/${data.adId}/unarchive`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Creative ─────────────────────────────────────────────────────────────────

// The bytes cross this boundary base64-encoded and are re-assembled into the
// multipart body the admin API expects — the same shape product media already
// uses, because a server function cannot forward a browser `File`.
export const uploadAdCreativeServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      adId: z.string().min(1),
      fileBase64: z.string().min(1),
      mimeType: z.string().min(1),
      fileName: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<Ad> => {
    const buffer = Buffer.from(data.fileBase64, "base64");
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([buffer], { type: data.mimeType }),
      data.fileName,
    );

    try {
      const res = await apiClient.post<Ad>(
        `/api/admin/campaigns/${data.campaignId}/ads/${data.adId}/creative`,
        formData,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// Removing a creative is not retiring an ad: it goes back to the state most ads
// are in and keeps measuring exactly what it measured before.
export const removeAdCreativeServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ campaignId: z.string().min(1), adId: z.string().min(1) }),
  )
  .handler(async ({ data }): Promise<Ad> => {
    try {
      const res = await apiClient.delete<Ad>(
        `/api/admin/campaigns/${data.campaignId}/ads/${data.adId}/creative`,
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
