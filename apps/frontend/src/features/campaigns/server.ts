import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import type { Ad, AttributedRevenueReport, Campaign } from "~/types/api";

async function storeHeaders() {
  return { ...(await authHeader()), ...adminStoreHeader() };
}

// Reads only. A campaign is the ad platform's: it is created and changed there,
// and arrives here through the connection. There is no create, edit, archive
// or delete to call.

export const getCampaignsServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Campaign[]> => {
    try {
      const res = await apiClient.get<Campaign[]>("/api/admin/campaigns", {
        headers: await storeHeaders(),
      });
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  },
);

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

export const getCampaignAdsServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }): Promise<Ad[]> => {
    try {
      const res = await apiClient.get<Ad[]>(
        `/api/admin/campaigns/${data.campaignId}/ads`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Revenue, orders and the platform's figures per campaign for a period.
 *
 * Each order is credited to the latest ad click — the last touch if it names a
 * campaign by the platform's id, otherwise the first — so there is no touch to
 * choose.
 */
export const getAttributedRevenueServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ period: z.enum(["today", "7d", "30d", "90d"]) }),
  )
  .handler(async ({ data }): Promise<AttributedRevenueReport> => {
    try {
      const res = await apiClient.get<AttributedRevenueReport>(
        `/api/admin/marketing/attributed-revenue?period=${data.period}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });
