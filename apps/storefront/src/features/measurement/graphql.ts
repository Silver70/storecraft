/**
 * The storefront's read of what it may measure.
 *
 * Public like every other operation here: it carries only the `X-API-Key` that
 * identifies the Store, attached server-side by `gqlFetch`. The answer names a
 * pixel the browser is about to load anyway, and nothing else about the
 * merchant's ad account.
 */

export const MEASUREMENT_SETTINGS_QUERY = /* GraphQL */ `
  query MeasurementSettings {
    measurementSettings {
      pixelId
      consentRequired
    }
  }
`;
