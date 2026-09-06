import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { apiClient, authHeader } from "~/lib/api-client";
import { adminStoreHeader } from "~/lib/active-store";
import { getErrorMessage } from "~/lib/errors";

export const getInlineEditConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { data } = await apiClient.get<{
        storefrontUrl: string;
        canEditProducts: boolean;
      }>("/api/admin/inline-edit", {
        headers: { ...(await authHeader()), ...adminStoreHeader() },
      });
      return data;
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  },
);

export const inlineEditQueryOptions = () =>
  queryOptions({
    queryKey: ["inline-edit"],
    queryFn: () => getInlineEditConfig(),
  });
