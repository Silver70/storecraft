import { queryOptions } from "@tanstack/react-query";
import { getMeasurementServerFn } from "./server";

export const MEASUREMENT_QUERY_KEY = ["measurement"] as const;

export const measurementQueryOptions = () =>
  queryOptions({
    queryKey: MEASUREMENT_QUERY_KEY,
    queryFn: () => getMeasurementServerFn(),
    // Connecting Meta should switch the pixel on without a deploy — but not
    // within the second, and not at the cost of a request per navigation. Five
    // minutes is the delay a merchant waits after connecting, and after that
    // every visitor who arrives gets it immediately.
    staleTime: 5 * 60_000,
  });
