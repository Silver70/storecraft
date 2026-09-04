/**
 * Attribution operations. Store-scoped like the rest of the cart API — the
 * `X-API-Key` is attached server-side and the cart id comes from the cookie.
 */

export const CREATE_CART_MUTATION = /* GraphQL */ `
  mutation CreateCart($attribution: CartAttributionInput) {
    createCart(attribution: $attribution) {
      id
    }
  }
`;

export const RECORD_CART_ATTRIBUTION_MUTATION = /* GraphQL */ `
  mutation RecordCartAttribution(
    $cartId: ID!
    $attribution: CartAttributionInput!
  ) {
    recordCartAttribution(cartId: $cartId, attribution: $attribution) {
      id
    }
  }
`;
