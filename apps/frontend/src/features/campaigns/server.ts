import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import type {
  AdAccountChoice,
  AddAdOutcome,
  AdPlatformConnection,
  AdPlatformSyncOutcome,
  AttributedRevenueReport,
  Campaign,
  CampaignFormContext,
  CampaignPerformanceReport,
  CreateCampaignOutcome,
  DraftComplaint,
  TrackingOutcome,
  UpdateCampaignInput,
} from "~/types/api";

async function storeHeaders() {
  return { ...(await authHeader()), ...adminStoreHeader() };
}

// A campaign is the ad platform's. One created here is created there first and
// recorded here from the platform's answer; one built in Ads Manager arrives
// through the connection. There is no archive or delete to call.

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

/**
 * One campaign over a period: its figures, its ads and the ratios its page
 * shows. Read from what the sync already stored — this never reaches the ad
 * platform, so an outage there costs freshness, not the page.
 */
export const getCampaignPerformanceServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      period: z.enum(["7d", "30d", "90d", "lifetime"]),
    }),
  )
  .handler(async ({ data }): Promise<CampaignPerformanceReport> => {
    try {
      const res = await apiClient.get<CampaignPerformanceReport>(
        `/api/admin/marketing/campaigns/${data.campaignId}/performance?period=${data.period}`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Writes our link tags onto every ad of a campaign built in Ads Manager.
 *
 * Each tagged ad goes back through Meta's review, which is why the page asks
 * first. The answer is per ad and never an exception for a refused one: an ad
 * Meta will not retag comes back named, with the reason, beside the ones it
 * did.
 */
export const startCampaignTrackingServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }): Promise<TrackingOutcome> => {
    try {
      const res = await apiClient.post<TrackingOutcome>(
        `/api/admin/campaigns/${data.campaignId}/tracking`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Creating one ─────────────────────────────────────────────────────────────

/**
 * What the create form needs from the active store: the currency a budget is
 * typed in, the timezone its dates are read in, and whether an ad's link can
 * be built yet.
 */
export const getCampaignFormContextServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<CampaignFormContext> => {
  const storeId = getCookie("wos-active-store");
  if (!storeId) throw new Error("No store is selected.");
  try {
    const res = await apiClient.get<Omit<CampaignFormContext, "storeId">>(
      `/api/admin/stores/${storeId}/storefront`,
      { headers: await storeHeaders() },
    );
    return { storeId, ...res.data };
  } catch (err) {
    throw new Error(getErrorMessage(err));
  }
});

const campaignAdInput = z.object({
  mediaSource: z.enum(["product", "upload"]),
  productMediaId: z.string().optional(),
  uploadUrl: z.string().optional(),
  primaryText: z.string(),
  headline: z.string(),
  callToAction: z.enum([
    "shop_now",
    "buy_now",
    "order_now",
    "get_offer",
    "learn_more",
    "sign_up",
    "subscribe",
  ]),
  destination: z.enum(["product", "all_products", "home", "custom"]),
  destinationProductId: z.string().optional(),
  destinationPath: z.string().optional(),
});

/**
 * What a create answered: the campaign, or everything wrong with the form.
 *
 * A 422 is not an error here. It is the answer the form is built around: our
 * own rules and Meta's dry run, each complaint placed by field and by ad, and
 * nothing created.
 */
export type CreateCampaignResult =
  | { ok: true; outcome: CreateCampaignOutcome }
  | { ok: false; message: string; complaints: DraftComplaint[] };

/**
 * Creates the campaign at Meta and here.
 *
 * `idempotencyKey` is kept by the form across retries of one submission, so a
 * press whose answer was lost cannot make a second campaign when pressed again.
 */
export const createCampaignServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      idempotencyKey: z.string().min(1).max(255),
      campaign: z.object({
        name: z.string(),
        dailyBudget: z.number().int(),
        startDate: z.string(),
        endDate: z.string().nullable(),
        countries: z.array(z.string()),
        ageMin: z.number().int(),
        ageMax: z.number().int(),
        launch: z.enum(["active", "paused"]),
        ads: z.array(campaignAdInput),
      }),
    }),
  )
  .handler(async ({ data }): Promise<CreateCampaignResult> => {
    try {
      const res = await apiClient.post<CreateCampaignOutcome>(
        "/api/admin/campaigns",
        data.campaign,
        {
          headers: {
            ...(await storeHeaders()),
            "Idempotency-Key": data.idempotencyKey,
          },
        },
      );
      return { ok: true, outcome: res.data };
    } catch (err) {
      const rejection = err as {
        status?: number;
        data?: { message?: string; complaints?: DraftComplaint[] };
      };
      if (rejection.status === 422 && rejection.data?.complaints) {
        return {
          ok: false,
          message: rejection.data.message ?? "The campaign needs fixing.",
          complaints: rejection.data.complaints,
        };
      }
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Stores a picture or video an ad is made from, in this store's own storage.
 * The answer's URL is what the form sends back as `uploadUrl`.
 */
export const uploadCampaignCreativeServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      fileBase64: z.string().min(1),
      mimeType: z.string().min(1),
      fileName: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<{ url: string; kind: "image" | "video" }> => {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([Buffer.from(data.fileBase64, "base64")], {
        type: data.mimeType,
      }),
      data.fileName,
    );
    try {
      const res = await apiClient.post<{ url: string; kind: "image" | "video" }>(
        "/api/admin/campaigns/creatives",
        formData,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Changing one ─────────────────────────────────────────────────────────────
//
// Each change is made at Meta first and recorded here the moment Meta accepts
// it. A refusal is an answer rather than an error: Meta's own words, placed on
// the field they are about, with nothing changed.

/** A change answered: the campaign as it now stands, or why it did not. */
export type CampaignEditResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; complaints: DraftComplaint[] };

function refusalOf(err: unknown): { message: string; complaints: DraftComplaint[] } | null {
  const rejection = err as {
    status?: number;
    data?: { message?: string; complaints?: DraftComplaint[] };
  };
  if (rejection.status === 422) {
    return {
      message: rejection.data?.message ?? "Meta did not accept the change.",
      complaints: rejection.data?.complaints ?? [],
    };
  }
  return null;
}

/** Rename, daily budget, end date: whichever were sent. */
export const updateCampaignServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      changes: z.object({
        name: z.string().optional(),
        dailyBudget: z.number().int().optional(),
        endDate: z.string().nullable().optional(),
      }),
    }),
  )
  .handler(async ({ data }): Promise<CampaignEditResult<Campaign>> => {
    try {
      const res = await apiClient.patch<Campaign>(
        `/api/admin/campaigns/${data.campaignId}`,
        data.changes satisfies UpdateCampaignInput,
        { headers: await storeHeaders() },
      );
      return { ok: true, value: res.data };
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) return { ok: false, ...refusal };
      throw new Error(getErrorMessage(err));
    }
  });

/** Pauses or resumes the whole campaign. */
export const setCampaignDeliveryServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      status: z.enum(["active", "paused"]),
    }),
  )
  .handler(async ({ data }): Promise<CampaignEditResult<Campaign>> => {
    try {
      const res = await apiClient.put<Campaign>(
        `/api/admin/campaigns/${data.campaignId}/status`,
        { status: data.status },
        { headers: await storeHeaders() },
      );
      return { ok: true, value: res.data };
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) return { ok: false, ...refusal };
      throw new Error(getErrorMessage(err));
    }
  });

/** Pauses or resumes one ad, and nothing beside it. */
export const setAdDeliveryServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      adId: z.string().min(1),
      status: z.enum(["active", "paused"]),
    }),
  )
  .handler(async ({ data }): Promise<CampaignEditResult<Campaign>> => {
    try {
      const res = await apiClient.put<Campaign>(
        `/api/admin/campaigns/${data.campaignId}/ads/${data.adId}/status`,
        { status: data.status },
        { headers: await storeHeaders() },
      );
      return { ok: true, value: res.data };
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) return { ok: false, ...refusal };
      throw new Error(getErrorMessage(err));
    }
  });

/**
 * Adds one ad to a running campaign, from the create form's ad editor.
 *
 * `idempotencyKey` is kept by the dialog across retries of one submission, so
 * a press whose answer was lost cannot add a second ad when pressed again.
 */
export const addCampaignAdServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      idempotencyKey: z.string().min(1).max(255),
      ad: campaignAdInput,
    }),
  )
  .handler(async ({ data }): Promise<CampaignEditResult<AddAdOutcome>> => {
    try {
      const res = await apiClient.post<AddAdOutcome>(
        `/api/admin/campaigns/${data.campaignId}/ads`,
        data.ad,
        {
          headers: {
            ...(await storeHeaders()),
            "Idempotency-Key": data.idempotencyKey,
          },
        },
      );
      return { ok: true, value: res.data };
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) return { ok: false, ...refusal };
      throw new Error(getErrorMessage(err));
    }
  });

/** The cover: one of the campaign's ads' pictures, or an uploaded image. */
export const setCampaignCoverServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      campaignId: z.string().min(1),
      cover: z.union([
        z.object({ adId: z.string().min(1) }),
        z.object({ uploadUrl: z.string().min(1) }),
      ]),
    }),
  )
  .handler(async ({ data }): Promise<Campaign> => {
    try {
      const res = await apiClient.put<Campaign>(
        `/api/admin/campaigns/${data.campaignId}/cover`,
        data.cover,
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
