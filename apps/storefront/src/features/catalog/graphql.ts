/**
 * GraphQL operation strings for the catalog feature.
 *
 * All operations are public (require only the `X-API-Key`, attached server-side
 * by `gqlFetch`). The backend enforces active-only products, so no draft ever
 * leaks through these queries.
 */

// Fields needed to render a product card in a grid (list/home pages).
const PRODUCT_CARD_FIELDS = /* GraphQL */ `
  id
  name
  slug
  vendor
  minPrice
  maxPrice
  media {
    id
    url
    altText
    mediaType
    position
    isPrimary
  }
`;

export const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($first: Int, $after: String, $filter: ProductFilterInput) {
    products(first: $first, after: $after, filter: $filter) {
      edges {
        node { ${PRODUCT_CARD_FIELDS} }
        cursor
      }
      pageInfo {
        endCursor
        hasNextPage
      }
      totalCount
    }
  }
`;

export const PRODUCT_QUERY = /* GraphQL */ `
  query Product($slug: String) {
    product(slug: $slug) {
      id
      name
      slug
      description
      status
      vendor
      tags
      seoTitle
      seoDescription
      minPrice
      maxPrice
      categoryIds
      media {
        id
        url
        altText
        mediaType
        position
        isPrimary
      }
      options {
        id
        name
        position
        values {
          id
          value
          position
        }
      }
      variants {
        id
        sku
        name
        price
        compareAtPrice
        isActive
        position
        optionValues {
          id
          value
          position
        }
      }
    }
  }
`;

const CATEGORY_NODE_FIELDS = /* GraphQL */ `
  id
  name
  slug
  description
  parentId
  position
`;

export const CATEGORIES_QUERY = /* GraphQL */ `
  query Categories {
    categories {
      ${CATEGORY_NODE_FIELDS}
      children {
        ${CATEGORY_NODE_FIELDS}
        children {
          ${CATEGORY_NODE_FIELDS}
        }
      }
    }
  }
`;

export const CATEGORY_BY_SLUG_QUERY = /* GraphQL */ `
  query Category($slug: String) {
    category(slug: $slug) {
      ${CATEGORY_NODE_FIELDS}
      children {
        ${CATEGORY_NODE_FIELDS}
      }
    }
  }
`;
