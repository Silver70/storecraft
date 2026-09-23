import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import type {
  Ad,
  AdAccountChoice,
  AdPlatformConnection,
  AdPlatformSyncOutcome,
  AttributedRevenueReport,
  Campaign,
} from "~/types/api";

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
  .inputValidator(z.object({ period: z.enum(["today", "7d", "30d", "90d"]) }))
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

// ─── The connection ───────────────────────────────────────────────────────────
//
// Meta lives on this page rather than in Settings, because it is not a
// preference: before it exists there are no campaigns to show, and after it
// exists it is the header line that says how fresh every figure below is.

const metaPlatform = z.object({ platform: z.literal("meta") });

export const getAdPlatformConnectionsServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<AdPlatformConnection[]> => {
  try {
    const res = await apiClient.get<AdPlatformConnection[]>(
      "/api/admin/ad-platforms",
      { headers: await storeHeaders() },
    );
    return res.data;
  } catch (err) {
    throw new Error(getErrorMessage(err));
  }
});

/**
 * Starts a connection and hands back the platform's own approval link, which
 * the browser is then sent to.
 *
 * We build no approval screen and no Page picker: the merchant approves on
 * Meta's own screen with their own credentials, picks a Facebook Page where
 * Meta asks for one, and comes back here either way.
 */
export const connectAdPlatformServerFn = createServerFn({ method: "POST" })
  .inputValidator(metaPlatform)
  .handler(async ({ data }): Promise<{ approvalUrl: string }> => {
    try {
      const res = await apiClient.post<{ approvalUrl: string }>(
        `/api/admin/ad-platforms/${data.platform}/connect`,
        { returnPath: "/admin/campaigns" },
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * The ad accounts the approved login can see.
 *
 * Which account this store reports against is our question, not Meta's — it has
 * never heard of this store — so it is asked here, after the merchant is back.
 */
export const getAdAccountsServerFn = createServerFn({ method: "GET" })
  .inputValidator(metaPlatform)
  .handler(async ({ data }): Promise<AdAccountChoice[]> => {
    try {
      const res = await apiClient.get<AdAccountChoice[]>(
        `/api/admin/ad-platforms/${data.platform}/ad-accounts`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Records the ad account the merchant picked.
 *
 * The picker disables an account in the wrong currency, and the server refuses
 * one too — so a mismatch arriving by any other route comes back as the same
 * sentence rather than as a connection nobody can trust.
 */
export const selectAdAccountServerFn = createServerFn({ method: "POST" })
  .inputValidator(metaPlatform.extend({ accountId: z.string().min(1) }))
  .handler(async ({ data }): Promise<AdPlatformConnection> => {
    try {
      const res = await apiClient.post<AdPlatformConnection>(
        `/api/admin/ad-platforms/${data.platform}/account`,
        { accountId: data.accountId },
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * A sync the merchant asked for, without waiting for the schedule.
 *
 * The response carries what happened — including a failure — rather than
 * throwing it, so a platform that refuses the call becomes a sentence on the
 * page instead of an error the merchant has to interpret. Only a transport
 * failure reaching our own API is an error here.
 */
export const syncAdPlatformServerFn = createServerFn({ method: "POST" })
  .inputValidator(metaPlatform)
  .handler(async ({ data }): Promise<AdPlatformSyncOutcome[]> => {
    try {
      const res = await apiClient.post<AdPlatformSyncOutcome[]>(
        `/api/admin/ad-platforms/${data.platform}/sync`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const disconnectAdPlatformServerFn = createServerFn({ method: "POST" })
  .inputValidator(metaPlatform)
  .handler(async ({ data }): Promise<AdPlatformConnection> => {
    try {
      const res = await apiClient.post<AdPlatformConnection>(
        `/api/admin/ad-platforms/${data.platform}/disconnect`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });
