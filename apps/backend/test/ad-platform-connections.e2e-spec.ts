/**
 * Connecting a Store to an ad platform, end to end through the admin REST API.
 *
 * Nothing is synced yet, so what is asserted here is everything that has to be
 * true before a figure is worth pulling: that a real merchant can grant access
 * on the platform's own screen, that the credential behind it is held per Store
 * and never handed back out, that another tenant cannot reach any of it, and
 * that disconnecting stops the access without deleting what it produced.
 *
 * The ad platform is the in-memory fake swapped in through the same seam the
 * payment provider's fake uses; everything else is production wiring against a
 * local Postgres database, and the return trip from the platform is followed
 * over real HTTP the way a merchant's browser would follow it.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../src/shared/database/database.module';
import {
  adPlatformConnections,
  adPlatformCredentials,
} from '../src/shared/database/schema';
import type { AdPlatform } from '../src/shared/database/schema';
import type { AdPlatformConnectionView } from '../src/modules/ad-platform/services/ad-platform-connection.service';
import { createTestApp } from './helpers/test-app';
import type { AdminClient } from './helpers/admin-client';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

describe('Ad platform connections (e2e)', () => {
  let app: INestApplication<App>;
  let db: DrizzleClient;
  let provider: FakeAdPlatformProvider;
  let fixture: AdminFixture;

  beforeAll(async () => {
    ({ app, adPlatform: provider } = await createTestApp());
    db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    provider.reset();
    fixture = await seedAdmin(app);
  });

  afterEach(async () => {
    await destroyAdmin(app, fixture);
  });

  // ─── Driving the flow the way a merchant's browser does ─────────────────────

  /** Starts a connection and returns the platform's approval link. */
  async function startConnection(
    client: AdminClient,
    platform: AdPlatform,
  ): Promise<{ approvalUrl: string; returnUrl: string; providerRef: string }> {
    const res = await client
      .post(`/ad-platforms/${platform}/connect`)
      .expect(201);

    const { approvalUrl } = res.body as { approvalUrl: string };
    const returnUrl = decodeURIComponent(
      new URL(approvalUrl).searchParams.get('return') ?? '',
    );
    const begun = provider.begun[provider.begun.length - 1];
    return { approvalUrl, returnUrl, providerRef: begun.providerRef };
  }

  /** Follows the return trip — a bare browser GET, with no admin token on it. */
  async function returnFromPlatform(returnUrl: string): Promise<string> {
    const url = new URL(returnUrl);
    const res = await request(app.getHttpServer())
      .get(`${url.pathname}${url.search}`)
      .expect(302);
    return res.headers['location'];
  }

  /** The whole round trip, with the merchant approving an account. */
  async function connect(
    client: AdminClient,
    platform: AdPlatform,
    account: { accountName?: string; currency?: string } = {},
  ): Promise<{ redirect: string; providerRef: string; accountId: string }> {
    const { returnUrl, providerRef } = await startConnection(client, platform);
    const approved = provider.approve(providerRef, platform, account);
    const redirect = await returnFromPlatform(returnUrl);
    return { redirect, providerRef, accountId: approved.externalAccountId };
  }

  const listConnections = async (
    client: AdminClient,
  ): Promise<AdPlatformConnectionView[]> => {
    const res = await client.get('/ad-platforms').expect(200);
    return res.body as AdPlatformConnectionView[];
  };

  // ─── Granting access ────────────────────────────────────────────────────────

  describe('starting a connection', () => {
    it("sends the merchant to the platform's own approval screen", async () => {
      const { approvalUrl, returnUrl } = await startConnection(
        fixture.admin.client,
        'meta',
      );

      expect(approvalUrl).toContain('https://approve.test/meta');
      // The trip ends back at us, carrying the signed note that says whose
      // connection this is — the browser will bring no admin token.
      expect(returnUrl).toContain('/api/ad-platforms/callback');
      expect(new URL(returnUrl).searchParams.get('state')).toBeTruthy();
      expect(provider.begun).toHaveLength(1);
      expect(provider.begun[0].platform).toBe('meta');
    });

    it('records nothing until the merchant actually approves', async () => {
      await startConnection(fixture.admin.client, 'meta');
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });
  });

  describe('coming back approved', () => {
    it('lists the platform as connected, with the account and when access was granted', async () => {
      const before = Date.now();
      const { accountId } = await connect(fixture.admin.client, 'meta', {
        accountName: 'Northwind Ads',
        currency: 'USD',
      });

      const [connection] = await listConnections(fixture.admin.client);
      expect(connection).toMatchObject({
        platform: 'meta',
        status: 'connected',
        accountId,
        accountName: 'Northwind Ads',
        accountCurrency: 'USD',
        disconnectedAt: null,
      });
      expect(new Date(connection.connectedAt).getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    });

    it('lands the merchant back in the admin where they started', async () => {
      const { redirect } = await connect(fixture.admin.client, 'meta');

      const url = new URL(redirect);
      expect(url.origin).toBe('http://localhost:3000');
      expect(url.pathname).toBe('/admin/settings');
      expect(url.searchParams.get('section')).toBe('ad-platforms');
      expect(url.searchParams.get('ad_platform')).toBe('meta');
      expect(url.searchParams.get('ad_platform_result')).toBe('connected');
    });

    it('records the ad account currency as it is, even when it differs from the store', async () => {
      // No conversion anywhere: a figure in another currency is stored as what
      // it is, and the mismatch stays visible (ADR-0005).
      await connect(fixture.admin.client, 'meta', { currency: 'GBP' });

      const [connection] = await listConnections(fixture.admin.client);
      expect(connection.accountCurrency).toBe('GBP');
    });
  });

  describe('coming back without approving', () => {
    it('returns the merchant to the admin and says so, rather than to a dead end', async () => {
      const { returnUrl } = await startConnection(fixture.admin.client, 'meta');
      // The merchant denied, or closed the tab on the platform's screen.
      const redirect = await returnFromPlatform(returnUrl);

      expect(new URL(redirect).searchParams.get('ad_platform_result')).toBe(
        'not_approved',
      );
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });

    it('survives the platform being down on the return trip', async () => {
      const { returnUrl } = await startConnection(fixture.admin.client, 'meta');
      provider.failNext = new Error('upstream quota exceeded');

      const redirect = await returnFromPlatform(returnUrl);

      expect(new URL(redirect).searchParams.get('ad_platform_result')).toBe(
        'failed',
      );
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });

    it('refuses a return trip nobody signed, and still lands somewhere sensible', async () => {
      const redirect = await returnFromPlatform(
        'http://localhost:4000/api/ad-platforms/callback?state=forged',
      );

      const url = new URL(redirect);
      expect(url.pathname).toBe('/admin/settings');
      expect(url.searchParams.get('ad_platform_result')).toBe('failed');
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });
  });

  // ─── The credential ─────────────────────────────────────────────────────────

  describe('the credential', () => {
    it('is never returned by a read', async () => {
      const { providerRef } = await connect(fixture.admin.client, 'meta');
      const secret = provider.credentialFor(fixture.storeId)?.secret;
      expect(secret).toBeTruthy();

      const res = await fixture.admin.client.get('/ad-platforms').expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(secret);
      expect(body).not.toContain(providerRef);
      expect(body).not.toContain('secret');
    });

    it('is sealed at rest, so the row does not hold the secret either', async () => {
      await connect(fixture.admin.client, 'meta');
      const secret = provider.credentialFor(fixture.storeId)!.secret;

      const [row] = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));

      expect(row.sealedSecret).toBeTruthy();
      expect(row.sealedSecret).not.toContain(secret);
      expect(row.sealedSecret!.startsWith('v1.')).toBe(true);
    });

    it('is issued per store and not once for the organization', async () => {
      const second = await fixture.addStore();

      await connect(fixture.admin.client, 'meta');
      await connect(second.client, 'meta');

      expect(provider.issued).toHaveLength(2);
      const [first, other] = provider.issued;
      expect(first.storeId).toBe(fixture.storeId);
      expect(other.storeId).toBe(second.storeId);
      expect(first.secret).not.toBe(other.secret);
      expect(first.providerRef).not.toBe(other.providerRef);
    });

    it('is reused for a second platform on the same store', async () => {
      await connect(fixture.admin.client, 'meta');
      await connect(fixture.admin.client, 'google');

      expect(provider.issued).toHaveLength(1);
      const rows = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));
      expect(rows).toHaveLength(1);
    });
  });

  // ─── Seeing and revoking ────────────────────────────────────────────────────

  describe('what a store is connected to', () => {
    it('lists each platform separately with its own connection date', async () => {
      await connect(fixture.admin.client, 'meta', { accountName: 'Meta Ads' });
      await connect(fixture.admin.client, 'google', {
        accountName: 'Google Ads',
      });

      const connections = await listConnections(fixture.admin.client);
      expect(connections.map((c) => c.platform).sort()).toEqual([
        'google',
        'meta',
      ]);
      for (const connection of connections) {
        expect(connection.status).toBe('connected');
        expect(connection.connectedAt).toBeTruthy();
      }
    });

    it("does not show one store's connection on another store in the same organization", async () => {
      const second = await fixture.addStore();
      await connect(fixture.admin.client, 'meta');

      expect(await listConnections(second.client)).toEqual([]);
    });
  });

  describe('disconnecting', () => {
    it('keeps the connection so that nothing already pulled is rewritten', async () => {
      await connect(fixture.admin.client, 'meta');
      const [before] = await listConnections(fixture.admin.client);

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      const [after] = await listConnections(fixture.admin.client);
      // The same row, stopped — not a deletion, because a Reported Figure will
      // point at this id and revoking access must not rewrite a past report.
      expect(after.id).toBe(before.id);
      expect(after.status).toBe('disconnected');
      expect(after.disconnectedAt).toBeTruthy();
      expect(after.connectedAt).toBe(before.connectedAt);
      expect(after.accountId).toBe(before.accountId);
    });

    it('revokes access at the platform and destroys the credential', async () => {
      const { providerRef } = await connect(fixture.admin.client, 'meta');

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      expect(provider.disconnected).toEqual([
        { providerRef, platform: 'meta' },
      ]);
      expect(provider.revoked).toEqual([providerRef]);

      const [row] = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));
      expect(row.sealedSecret).toBeNull();
      expect(row.revokedAt).toBeTruthy();
    });

    it('keeps the credential while another platform still needs it', async () => {
      const { providerRef } = await connect(fixture.admin.client, 'meta');
      await connect(fixture.admin.client, 'google');

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      expect(provider.disconnected).toEqual([
        { providerRef, platform: 'meta' },
      ]);
      expect(provider.revoked).toEqual([]);

      const [row] = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));
      expect(row.sealedSecret).toBeTruthy();
    });

    it('grants access again in place when the merchant reconnects', async () => {
      await connect(fixture.admin.client, 'meta');
      const [before] = await listConnections(fixture.admin.client);
      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      await connect(fixture.admin.client, 'meta');

      const connections = await listConnections(fixture.admin.client);
      expect(connections).toHaveLength(1);
      expect(connections[0].id).toBe(before.id);
      expect(connections[0].status).toBe('connected');
      expect(connections[0].disconnectedAt).toBeNull();
      // A destroyed credential is re-issued rather than resurrected.
      expect(provider.issued).toHaveLength(2);
    });

    it('is a 404 for a platform this store never connected', async () => {
      await fixture.admin.client
        .post('/ad-platforms/tiktok/disconnect')
        .expect(404);
    });
  });

  // ─── Boundaries ─────────────────────────────────────────────────────────────

  describe('tenancy', () => {
    it('is unreachable from another organization', async () => {
      await connect(fixture.admin.client, 'meta');
      const other = await seedAdmin(app);

      try {
        expect(await listConnections(other.admin.client)).toEqual([]);
        await other.admin.client
          .post('/ad-platforms/meta/disconnect')
          .expect(404);

        // And the original is untouched by the attempt.
        const [connection] = await listConnections(fixture.admin.client);
        expect(connection.status).toBe('connected');
      } finally {
        await destroyAdmin(app, other);
      }
    });
  });

  describe('permissions', () => {
    it('lets a product manager see what is connected but not grant or revoke access', async () => {
      await connect(fixture.admin.client, 'meta');
      const manager = await fixture.addUser('product_manager');

      await manager.client.get('/ad-platforms').expect(200);
      await manager.client.post('/ad-platforms/google/connect').expect(403);
      await manager.client.post('/ad-platforms/meta/disconnect').expect(403);
    });

    it('rejects a request with no admin token at all', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/ad-platforms')
        .expect(401);
    });
  });

  describe('the platform argument', () => {
    it('refuses a platform nothing can be pulled from', async () => {
      // `email`, `sms`, `affiliate` and `influencer` are Campaign platforms with
      // no ad tree behind them; they stay hand-costed permanently.
      await fixture.admin.client
        .post('/ad-platforms/email/connect')
        .expect(400);
    });
  });

  // ─── Unsupported connections ───────────────────────────────────────────────

  it('tells the merchant the platform is unreachable rather than failing at them, and connects nothing', async () => {
    provider.failNext = new Error('service unavailable');

    const res = await fixture.admin.client
      .post('/ad-platforms/meta/connect')
      .expect(503);
    // The refusal is frequently an upstream quota shared across every customer
    // of the provider, so the message must not blame the merchant's account.
    expect((res.body as { message: string }).message).toMatch(
      /could not be reached/i,
    );

    expect(await listConnections(fixture.admin.client)).toEqual([]);

    const rows = await db
      .select()
      .from(adPlatformConnections)
      .where(eq(adPlatformConnections.storeId, fixture.storeId));
    expect(rows).toEqual([]);
  });
});
