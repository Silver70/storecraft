import { z } from "zod";

/**
 * Validation for attribution crossing the browser → Start-server boundary.
 *
 * The limits match the commerce API's columns so a value that would be rejected
 * there is trimmed here instead. Callers wrap this in `.catch(undefined)`:
 * attribution that fails to parse must degrade to no attribution, never fail
 * the add-to-cart or checkout it rides along with.
 */
const touchSchema = z.object({
  utmSource: z.string().max(255).optional(),
  utmMedium: z.string().max(255).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
  referrer: z.string().max(1024).optional(),
  landingPath: z.string().max(1024).optional(),
  occurredAt: z.string().datetime().optional(),
});

export const declaredAttributionSchema = z.object({
  firstTouch: touchSchema.optional(),
  lastTouch: touchSchema.optional(),
  visitorId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
});

export type DeclaredAttributionInput = z.infer<
  typeof declaredAttributionSchema
>;

/** Optional, and never a reason to reject the request it accompanies. */
export const optionalAttribution = declaredAttributionSchema
  .optional()
  .catch(undefined);
