import { queryOptions } from "@tanstack/react-query";
import {
  getApiKeysServerFn,
  getAuditLogsServerFn,
  getOrganizationServerFn,
  getTaxRatesServerFn,
} from "./server";
import { getStoresServerFn } from "~/server/stores";

export const organizationQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "organization"],
    queryFn: () => getOrganizationServerFn(),
    staleTime: 5 * 60 * 1000,
  });

export const storesQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "stores"],
    queryFn: () => getStoresServerFn(),
    staleTime: 5 * 60 * 1000,
  });

export const apiKeysQueryOptions = (storeId: string) =>
  queryOptions({
    queryKey: ["settings", "api-keys", storeId],
    queryFn: () => getApiKeysServerFn({ data: { storeId } }),
    enabled: !!storeId,
    staleTime: 60 * 1000,
  });

export const taxRatesQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "tax-rates"],
    queryFn: () => getTaxRatesServerFn(),
    staleTime: 60 * 1000,
  });

export const auditLogsQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "audit-logs"],
    queryFn: () => getAuditLogsServerFn({ data: { limit: 50 } }),
    staleTime: 60 * 1000,
  });
