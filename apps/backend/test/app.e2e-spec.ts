/**
 * The application boots against the local test database and serves GraphQL.
 * If this fails, every other e2e failure is noise.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './helpers/test-app';

describe('Application (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the GraphQL health query', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ _health }' })
      .expect(200);

    expect((response.body as { data: { _health: boolean } }).data._health).toBe(
      true,
    );
  });
});
