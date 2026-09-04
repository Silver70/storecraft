import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Talks to the admin REST API the way the dashboard does: over HTTP, carrying a
 * real admin access token and the active store header, with no access to the
 * services behind it. Every method returns the supertest request, so a test
 * asserts on the status the merchant would actually get.
 */
export class AdminClient {
  constructor(
    private readonly app: INestApplication<App>,
    private readonly accessToken: string,
    private readonly storeId: string,
  ) {}

  get(path: string) {
    return this.authed(request(this.app.getHttpServer()).get(this.url(path)));
  }

  post(path: string, body?: unknown) {
    return this.authed(
      request(this.app.getHttpServer()).post(this.url(path)),
    ).send(body ?? {});
  }

  patch(path: string, body?: unknown) {
    return this.authed(
      request(this.app.getHttpServer()).patch(this.url(path)),
    ).send(body ?? {});
  }

  delete(path: string) {
    return this.authed(
      request(this.app.getHttpServer()).delete(this.url(path)),
    );
  }

  private url(path: string): string {
    return `/api/admin${path}`;
  }

  private authed(req: request.Test): request.Test {
    return req
      .set('Authorization', `Bearer ${this.accessToken}`)
      .set('X-Store-Id', this.storeId);
  }
}
