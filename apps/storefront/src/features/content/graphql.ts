/**
 * The storefront's read of its own Content Slots.
 *
 * Public, like every other operation here: it carries only the `X-API-Key`
 * that identifies the Store, attached server-side by `gqlFetch`. It returns
 * published values, and there is no argument that would widen that — the
 * backend's public type has no draft field at all.
 */
export const CONTENT_SLOTS_QUERY = /* GraphQL */ `
  query ContentSlots {
    contentSlots {
      key
      type
      value
    }
  }
`;
