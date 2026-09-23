import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminStoreHeader } from "~/lib/active-store";
import { apiClient, authHeader } from "~/lib/api-client";
import { getErrorMessage } from "~/lib/errors";
import type {
  ApiKey,
  ApiKeyWithSecret,
  AuditEntry,
  Organization,
  PaginatedResponse,
  TaxRate,
} from "~/types/api";

async function storeHeaders() {
  return { ...(await authHeader()), ...adminStoreHeader() };
}

// ─── Get Organization ─────────────────────────────────────────────────────────

export const getOrganizationServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<Organization> => {
  try {
    const res = await apiClient.get<Organization>("/api/admin/organization", {
      headers: await authHeader(),
    });
    return res.data;
  } catch (err) {
    throw new Error(getErrorMessage(err));
  }
});

// ─── Update Organization ──────────────────────────────────────────────────────

// Org PATCH only updates name; currency/timezone are store-level (§4.9)
export const updateOrgServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z
        .string()
        .min(2, "Organization name must be at least 2 characters"),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const res = await apiClient.patch<Organization>(
        "/api/admin/organization",
        data,
        { headers: await authHeader() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const getApiKeysServerFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ storeId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ApiKey[]> => {
    try {
      const res = await apiClient.get<ApiKey[]>(
        `/api/admin/stores/${data.storeId}/api-keys`,
        { headers: { ...(await authHeader()), "X-Store-Id": data.storeId } },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const createApiKeyFromSettingsServerFn = createServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1, "Key name is required"),
      storeId: z.string().min(1, "Store ID is required"),
    }),
  )
  .handler(async ({ data }): Promise<ApiKeyWithSecret> => {
    try {
      const res = await apiClient.post<ApiKeyWithSecret>(
        `/api/admin/stores/${data.storeId}/api-keys`,
        { name: data.name },
        { headers: { ...(await authHeader()), "X-Store-Id": data.storeId } },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const deleteApiKeyServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ keyId: z.string().min(1), storeId: z.string().min(1) }),
  )
  .handler(async ({ data }) => {
    try {
      await apiClient.delete(`/api/admin/api-keys/${data.keyId}`, {
        headers: { ...(await authHeader()), "X-Store-Id": data.storeId },
      });
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Tax Rates ────────────────────────────────────────────────────────────────

export const getTaxRatesServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<TaxRate[]> => {
    try {
      const res = await apiClient.get<TaxRate[]>("/api/admin/tax-rates", {
        headers: await storeHeaders(),
      });
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  },
);

export const createTaxRateServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1, "Name is required"),
      rate: z
        .number()
        .int()
        .nonnegative("Rate must be non-negative basis points"),
      countryCode: z.string().length(2, "Must be ISO 3166-1 alpha-2"),
      stateCode: z.string().optional(),
      isInclusive: z.boolean(),
      isActive: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<TaxRate> => {
    try {
      const res = await apiClient.post<TaxRate>("/api/admin/tax-rates", data, {
        headers: await storeHeaders(),
      });
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const updateTaxRateServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      rate: z.number().int().nonnegative().optional(),
      countryCode: z.string().length(2).optional(),
      stateCode: z.string().optional(),
      isInclusive: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<TaxRate> => {
    try {
      const { id, ...body } = data;
      const res = await apiClient.patch<TaxRate>(
        `/api/admin/tax-rates/${id}`,
        body,
        {
          headers: await storeHeaders(),
        },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

export const deleteTaxRateServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    try {
      await apiClient.delete(`/api/admin/tax-rates/${data.id}`, {
        headers: await storeHeaders(),
      });
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const getAuditLogsServerFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      cursor: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }): Promise<PaginatedResponse<AuditEntry>> => {
    const params = new URLSearchParams();
    if (data.cursor) params.set("cursor", data.cursor);
    if (data.limit) params.set("limit", String(data.limit));
    try {
      const res = await apiClient.get<PaginatedResponse<AuditEntry>>(
        `/api/admin/audit-logs?${params.toString()}`,
        { headers: await authHeader() },
      );
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  });
