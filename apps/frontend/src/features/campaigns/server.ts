import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import { CAMPAIGN_PLATFORMS, type Campaign } from "~/types/api";

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
