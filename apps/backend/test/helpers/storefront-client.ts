import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Talks to the storefront GraphQL API the way a storefront does: over HTTP,
 * authenticated by an API key, with no access to the services behind it.
 */
export class StorefrontClient {
  constructor(
    private readonly app: INestApplication<App>,
    private readonly apiKey: string,
  ) {}

  /** Runs an operation and returns `data`, throwing on any GraphQL error. */
  async query<T>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.raw(document, variables);
    const body = response.body as {
      data?: T;
      errors?: { message: string }[];
    };

    if (body.errors?.length) {
      throw new Error(
        `GraphQL request failed: ${body.errors.map((e) => e.message).join('; ')}`,
      );
    }
    if (!body.data) {
      throw new Error(
        `GraphQL request returned no data (HTTP ${response.status})`,
      );
    }
    return body.data;
  }

  /** The unprocessed response, for tests asserting on failure. */
  raw(document: string, variables: Record<string, unknown> = {}) {
    return request(this.app.getHttpServer())
      .post('/graphql')
      .set('X-API-Key', this.apiKey)
      .send({ query: document, variables });
  }
}
