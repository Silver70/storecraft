import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { gqlFetch } from "~/lib/gql-client";
import { CONSENT_COOKIE, parseConsent } from "./consent";
import { MEASUREMENT_SETTINGS_QUERY } from "./graphql";
import type { ConsentAnswer, Measurement, MeasurementSettings } from "./types";

/**
 * Measuring nothing: what a storefront does when it cannot find out what it is
 * allowed to do. A missing pixel loads no script and a store that asks for
 * consent is not represented as one that does not, because with no pixel there
 * is nothing to consent to.
 */
const MEASURE_NOTHING: MeasurementSettings = {
  pixelId: null,
  consentRequired: false,
};

/**
 * What this store measures, and what this visitor has already answered.
 *
 * Both halves are read on the server: the settings so that a page is rendered
 * knowing whether it may carry a tracking script at all, and the answer from the
 * request's own cookie so that hydration agrees with the HTML instead of
 * flashing a banner at someone who answered last week.
 *
 * Never throws. A commerce API that is unreachable means the page renders
 * without measurement — which is the safe direction, and the only one: a
 * storefront that failed to load its own settings has no business assuming it
 * may track anybody.
 */
export const getMeasurementServerFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<Measurement> => {
  const consent: ConsentAnswer = parseConsent(getCookie(CONSENT_COOKIE));

  try {
    const res = await gqlFetch<{ measurementSettings: MeasurementSettings }>(
      MEASUREMENT_SETTINGS_QUERY,
    );
    return { ...res.measurementSettings, consent };
  } catch {
    return { ...MEASURE_NOTHING, consent };
  }
});
