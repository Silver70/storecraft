import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient, authHeader } from "~/lib/api-client";
import { adminStoreHeader } from "~/lib/active-store";
import { getErrorMessage } from "~/lib/errors";

/**
 * A Content Slot as the admin sees it: what shoppers are reading, and what the
 * merchant has written but not yet published. The editor is the only surface
 * that ever holds both, which is why it is also the surface that has to say
 * plainly which is which.
 */
export interface ContentSlot {
  key: string;
  type: "heading" | "text";
  /** The published value. Null until the merchant has published once. */
  value: string | null;
  /** Unpublished work. Null when there is none. */
  draftValue: string | null;
  status: "draft" | "published";
  lastPublishedAt: string | null;
}

async function storeHeaders() {
  return { ...(await authHeader()), ...adminStoreHeader() };
}

const slotKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

export const getContentSlotsServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<ContentSlot[]> => {
  try {
    const { data } = await apiClient.get<ContentSlot[]>(
      "/api/admin/content/slots",
      { headers: await storeHeaders() },
    );
    return data;
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
});

/**
 * Saves the merchant's unpublished work. The published value is untouched, so
 * shoppers keep reading the live copy for as long as this draft exists.
 */
export const saveContentSlotDraftServerFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      key: slotKeySchema,
      type: z.enum(["heading", "text"]),
      value: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<ContentSlot> => {
    const { key, ...body } = data;
    try {
      const res = await apiClient.put<ContentSlot>(
        `/api/admin/content/slots/${encodeURIComponent(key)}/draft`,
        body,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  });

/**
 * Throws the draft away and leaves the published value exactly as it was, so
 * abandoning an idea is one action and never takes live copy down with it.
 */
export const discardContentSlotDraftServerFn = createServerFn({
  method: "POST",
})
  .inputValidator(z.object({ key: slotKeySchema }))
  .handler(async ({ data }): Promise<ContentSlot> => {
    try {
      const res = await apiClient.delete<ContentSlot>(
        `/api/admin/content/slots/${encodeURIComponent(data.key)}/draft`,
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  });

/** Makes the drafted value the one shoppers see. */
export const publishContentSlotServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ key: slotKeySchema }))
  .handler(async ({ data }): Promise<ContentSlot> => {
    try {
      const res = await apiClient.post<ContentSlot>(
        `/api/admin/content/slots/${encodeURIComponent(data.key)}/publish`,
        {},
        { headers: await storeHeaders() },
      );
      return res.data;
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  });

export const contentSlotsQueryOptions = () =>
  queryOptions({
    queryKey: ["content-slots"],
    queryFn: () => getContentSlotsServerFn(),
  });
