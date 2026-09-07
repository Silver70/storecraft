import { createServerFn } from "@tanstack/react-start";
import { gqlFetch } from "~/lib/gql-client";
import type { ContentSlot } from "~/types/api";
import { CONTENT_SLOTS_QUERY } from "./graphql";

export const getContentSlotsServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<ContentSlot[]> => {
  const res = await gqlFetch<{ contentSlots: ContentSlot[] }>(
    CONTENT_SLOTS_QUERY,
  );
  return res.contentSlots;
});
