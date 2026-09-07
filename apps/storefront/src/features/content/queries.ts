import { queryOptions } from "@tanstack/react-query";
import { getContentSlotsServerFn } from "./server";

export const contentSlotsQueryOptions = () =>
  queryOptions({
    queryKey: ["content-slots"],
    queryFn: () => getContentSlotsServerFn(),
    // Copy the merchant publishes should appear without a deploy, but it is
    // not per-request data either.
    staleTime: 60_000,
  });
