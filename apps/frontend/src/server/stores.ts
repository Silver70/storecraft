import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import type { Store } from "~/types/api";

const ONBOARDING_COOKIE_OPTS = {
  path: "/",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60,
};

// ─── List Stores ──────────────────────────────────────────────────────────────

export const getStoresServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Store[]> => {
    try {
      const res = await apiClient.get<Store[]>("/api/admin/stores", {
        headers: await authHeader(),
      });
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  },
);

// ─── Create Store ─────────────────────────────────────────────────────────────

export const createStoreServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(2, "Store name must be at least 2 characters"),
      currency: z.string().length(3, "Currency must be a 3-letter code"),
      timezone: z.string().min(1, "Timezone is required"),
    }),
  )
  .handler(async ({ data }): Promise<Store> => {
    try {
      const res = await apiClient.post<Store>("/api/admin/stores", data, {
        headers: await authHeader(),
      });
      setCookie("wos-active-store", res.data.id, ONBOARDING_COOKIE_OPTS);
      setCookie("wos-onboarding-step", "2", ONBOARDING_COOKIE_OPTS);
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Create Store (in-app) ────────────────────────────────────────────────────
// Like createStore, but for the running admin app rather than onboarding: it
// switches the active store to the newly created one WITHOUT touching the
// `wos-onboarding-step` cookie. Setting that cookie (as createStoreServerFn
// does) would bounce the user back into the onboarding wizard on the next
// admin navigation — see routes/admin/route.tsx beforeLoad.

export const createStoreInAppServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(2, "Store name must be at least 2 characters"),
      currency: z.string().length(3, "Currency must be a 3-letter code"),
      timezone: z.string().min(1, "Timezone is required"),
    }),
  )
  .handler(async ({ data }): Promise<Store> => {
    try {
      const res = await apiClient.post<Store>("/api/admin/stores", data, {
        headers: await authHeader(),
      });
      // Make the new store the active one so the admin lands in it immediately.
      setCookie("wos-active-store", res.data.id, ONBOARDING_COOKIE_OPTS);
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Toggle Store Active ──────────────────────────────────────────────────────

export const setStoreActiveServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ storeId: z.string().min(1), isActive: z.boolean() }),
  )
  .handler(async ({ data }): Promise<Store> => {
    try {
      const res = await apiClient.patch<Store>(
        `/api/admin/stores/${data.storeId}`,
        { isActive: data.isActive },
        { headers: { ...(await authHeader()), ...adminStoreHeader() } },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Delete Store ─────────────────────────────────────────────────────────────

export const deleteStoreServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ storeId: z.string().min(1) }))
  .handler(async ({ data }) => {
    try {
      await apiClient.delete(`/api/admin/stores/${data.storeId}`, {
        headers: { ...(await authHeader()), ...adminStoreHeader() },
      });
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Update Store ─────────────────────────────────────────────────────────────

export const updateStoreServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      storeId: z.string().min(1),
      name: z.string().min(2, "Store name must be at least 2 characters"),
      currency: z.string().length(3, "Currency must be a 3-letter code"),
      timezone: z.string().min(1, "Timezone is required"),
      // Both optional: the backend validates and normalizes them, and is the
      // one place the URL rules live. An empty storefrontUrl clears it.
      storefrontUrl: z.string().optional(),
      productPathPattern: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const { storeId, ...body } = data;
      const res = await apiClient.patch<Store>(
        `/api/admin/stores/${storeId}`,
        body,
        {
          headers: {
            ...(await authHeader()),
            ...adminStoreHeader(),
          },
        },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Set Active Store ─────────────────────────────────────────────────────────

export const setActiveStoreServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ storeId: z.string().min(1) }))
  .handler(async ({ data }) => {
    setCookie("wos-active-store", data.storeId, {
      path: "/",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

// ─── Ensure Active Store ──────────────────────────────────────────────────────
// Called from the admin layout beforeLoad to guarantee wos-active-store is
// always set to a valid store. Fixes silent empty results / "no active store"
// errors for any server function that reads the cookie (adminStoreHeader, etc.).

export const ensureActiveStoreServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      storeIds: z.array(z.string().min(1)),
      fallbackId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const current = getCookie("wos-active-store");
    if (!current || !data.storeIds.includes(current)) {
      setCookie("wos-active-store", data.fallbackId, {
        path: "/",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60,
      });
    }
  });

// ─── Onboarding Step Cookie ───────────────────────────────────────────────────

export const getOnboardingStepServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<string | null> => {
  const step = getCookie("wos-onboarding-step");
  if (!step || !["1", "2", "3"].includes(step)) return null;
  return step;
});

export const setOnboardingStepServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ step: z.enum(["2", "3"]) }))
  .handler(async ({ data }) => {
    setCookie("wos-onboarding-step", data.step, ONBOARDING_COOKIE_OPTS);
  });

export const clearOnboardingCookieServerFn = createServerFn({
  method: "POST",
}).handler(async () => {
  setCookie("wos-onboarding-step", "", { path: "/", maxAge: 0 });
});

export const clearActiveStoreCookieServerFn = createServerFn({
  method: "POST",
}).handler(async () => {
  setCookie("wos-active-store", "", { path: "/", maxAge: 0 });
});
