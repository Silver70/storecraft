/**
 * Connecting a Store to Meta, end to end through the admin REST API.
 *
 * Nothing is synced yet, so what is asserted here is everything that has to be
 * true before a figure is worth pulling: that a real merchant can grant access
 * on the platform's own screen and then choose which of their ad accounts this
 * Store reports against, that an account in the wrong currency is refused with
 * a reason rather than quietly converted, that the credential behind it is held
 * per Store and never handed back out, that another tenant cannot reach any of
 * it, and that disconnecting stops the access without deleting what it
 * produced.
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
import type {
  AdAccountChoice,
  AdPlatformConnectionView,
} from '../src/modules/ad-platform/services/ad-platform-connection.service';
import type { AdAccountOption } from '../src/modules/ad-platform/interfaces/ad-platform-provider.interface';
import { createTestApp } from './helpers/test-app';
import type { AdminClient } from './helpers/admin-client';
import type { FakeAdPlatformProvider } from './helpers/fake-ad-platform-provider';
import {
  destroyAdmin,
  seedAdmin,
  type AdminFixture,
} from './helpers/admin-fixture';

describe('Connecting a store to Meta (e2e)', () => {
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

  /**
   * The trip out and back, with the merchant approving at the platform.
   *
   * It stops where the platform's part stops. Which ad account this Store
   * reports against is our question, not Meta's, and is asked afterwards.
   */
  async function approve(
    client: AdminClient,
    platform: AdPlatform,
    accounts: Partial<AdAccountOption>[] = [{}],
  ): Promise<{ redirect: string; providerRef: string }> {
    const { returnUrl, providerRef } = await startConnection(client, platform);
    provider.approve(providerRef, platform, accounts);
    const redirect = await returnFromPlatform(returnUrl);
    return { redirect, providerRef };
  }

  const listConnections = async (
    client: AdminClient,
  ): Promise<AdPlatformConnectionView[]> => {
    const res = await client.get('/ad-platforms').expect(200);
    return res.body as AdPlatformConnectionView[];
  };

  const listAdAccounts = async (
    client: AdminClient,
    platform: AdPlatform = 'meta',
  ): Promise<AdAccountChoice[]> => {
    const res = await client
      .get(`/ad-platforms/${platform}/ad-accounts`)
      .expect(200);
    return res.body as AdAccountChoice[];
  };

  const resultOf = (redirect: string): string | null =>
    new URL(redirect).searchParams.get('ad_platform_result');

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

  describe('coming back with one usable ad account', () => {
    it('connects without asking a question that has one answer', async () => {
      const before = Date.now();
      const { redirect } = await approve(fixture.admin.client, 'meta', [
        {
          externalAccountId: 'act_sole',
          name: 'Northwind Ads',
          currency: 'USD',
        },
      ]);

      expect(resultOf(redirect)).toBe('connected');

      const [connection] = await listConnections(fixture.admin.client);
      expect(connection).toMatchObject({
        platform: 'meta',
        status: 'connected',
        accountId: 'act_sole',
        accountName: 'Northwind Ads',
        accountCurrency: 'USD',
        disconnectedAt: null,
      });
      expect(new Date(connection.connectedAt).getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    });

    it('lands the merchant back in the admin where they started', async () => {
      const { redirect } = await approve(fixture.admin.client, 'meta');

      const url = new URL(redirect);
      expect(url.origin).toBe('http://localhost:3000');
      expect(url.pathname).toBe('/admin/campaigns');
      expect(url.searchParams.get('ad_platform')).toBe('meta');
      expect(url.searchParams.get('ad_platform_result')).toBe('connected');
    });
  });

  describe('coming back with several ad accounts', () => {
    const several: Partial<AdAccountOption>[] = [
      { externalAccountId: 'act_us', name: 'US Ads', currency: 'USD' },
      { externalAccountId: 'act_uk', name: 'UK Ads', currency: 'GBP' },
      { externalAccountId: 'act_eu', name: 'EU Ads', currency: 'USD' },
    ];

    it('asks the merchant to pick one rather than guessing', async () => {
      const { redirect } = await approve(fixture.admin.client, 'meta', several);

      expect(resultOf(redirect)).toBe('choose_account');

      const [connection] = await listConnections(fixture.admin.client);
      // Approved, but not yet reporting against anything. The grant is a row
      // rather than a thing held in the browser, so closing the tab does not
      // cost the merchant another trip through Meta.
      expect(connection.status).toBe('awaiting_account');
      expect(connection.accountId).toBeNull();
    });

    it('offers every account, and disables the wrong-currency one with the reason', async () => {
      await approve(fixture.admin.client, 'meta', several);

      const choices = await listAdAccounts(fixture.admin.client);
      expect(choices.map((choice) => choice.accountId)).toEqual([
        'act_us',
        'act_uk',
        'act_eu',
      ]);

      const [us, uk] = choices;
      expect(us).toMatchObject({ selectable: true, reason: null });
      // Listed, not hidden: an account missing from the picker is a merchant
      // wondering whether they approved with the wrong login.
      expect(uk.selectable).toBe(false);
      expect(uk.reason).toContain('GBP');
      expect(uk.reason).toMatch(/never converted/i);
    });

    it("passes the platform's own objection through rather than overwriting it", async () => {
      await approve(fixture.admin.client, 'meta', [
        {
          externalAccountId: 'act_frozen',
          currency: 'USD',
          unusableReason: 'This ad account has an unpaid balance.',
        },
      ]);

      const [choice] = await listAdAccounts(fixture.admin.client);
      expect(choice.selectable).toBe(false);
      expect(choice.reason).toBe('This ad account has an unpaid balance.');
    });

    it('connects the one the merchant picks', async () => {
      await approve(fixture.admin.client, 'meta', several);

      const res = await fixture.admin.client
        .post('/ad-platforms/meta/account')
        .send({ accountId: 'act_eu' })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'connected',
        accountId: 'act_eu',
        accountName: 'EU Ads',
        accountCurrency: 'USD',
      });
    });
  });

  describe('an ad account in another currency', () => {
    it('is refused server-side too, not only in the picker', async () => {
      // The picker is a suggestion; this is the door. A mismatch accepted here
      // would put spend in one currency beside revenue in another, and every
      // ROAS on the page would be wrong by a rate nobody chose — silently.
      await approve(fixture.admin.client, 'meta', [
        // Two usable accounts, so nothing settles on the way back and the
        // merchant is genuinely at the picker when they name the third.
        { externalAccountId: 'act_us', currency: 'USD' },
        { externalAccountId: 'act_eu', currency: 'USD' },
        { externalAccountId: 'act_uk', currency: 'GBP' },
      ]);

      const res = await fixture.admin.client
        .post('/ad-platforms/meta/account')
        .send({ accountId: 'act_uk' })
        .expect(400);

      expect((res.body as { message: string }).message).toContain('GBP');

      const [connection] = await listConnections(fixture.admin.client);
      expect(connection.status).toBe('awaiting_account');
      expect(connection.accountId).toBeNull();
    });

    it('is never auto-connected, even when it is the only one there is', async () => {
      const { redirect } = await approve(fixture.admin.client, 'meta', [
        { externalAccountId: 'act_uk', currency: 'GBP' },
      ]);

      expect(resultOf(redirect)).toBe('choose_account');

      const [choice] = await listAdAccounts(fixture.admin.client);
      expect(choice.selectable).toBe(false);
    });

    it('refuses an account the grant cannot reach at all', async () => {
      await approve(fixture.admin.client, 'meta', [
        { externalAccountId: 'act_us', currency: 'USD' },
        { externalAccountId: 'act_two', currency: 'USD' },
      ]);

      await fixture.admin.client
        .post('/ad-platforms/meta/account')
        .send({ accountId: 'act_someone_elses' })
        .expect(404);
    });
  });

  // ─── The pixel ──────────────────────────────────────────────────────────────

  describe('the pixel', () => {
    it("uses the ad account's existing pixel rather than making a second one", async () => {
      provider.setExistingPixel('act_sole', '1729525464415281');
      await approve(fixture.admin.client, 'meta', [
        { externalAccountId: 'act_sole', currency: 'USD' },
      ]);

      const [connection] = await listConnections(fixture.admin.client);
      expect(connection.pixelId).toBe('1729525464415281');
      expect(provider.pixels).toHaveLength(1);
      expect(provider.pixels[0].created).toBe(false);
    });

    it('creates one named after the store when the account has none', async () => {
      await approve(fixture.admin.client, 'meta', [
        { externalAccountId: 'act_sole', currency: 'USD' },
      ]);

      const [connection] = await listConnections(fixture.admin.client);
      expect(connection.pixelId).toBeTruthy();

      const [asked] = provider.pixels;
      expect(asked.created).toBe(true);
      expect(asked.externalAccountId).toBe('act_sole');
      expect(asked.storeName).toContain('E2E Store');
    });
  });

  // ─── Approving nothing ──────────────────────────────────────────────────────

  describe('coming back without approving', () => {
    it('returns the merchant to the admin and says so, rather than to a dead end', async () => {
      const { returnUrl } = await startConnection(fixture.admin.client, 'meta');
      // The merchant denied, or closed the tab on the platform's screen.
      const redirect = await returnFromPlatform(returnUrl);

      expect(resultOf(redirect)).toBe('not_approved');
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });

    it('survives the platform being down on the return trip', async () => {
      const { returnUrl } = await startConnection(fixture.admin.client, 'meta');
      provider.failNext = new Error('upstream quota exceeded');

      const redirect = await returnFromPlatform(returnUrl);

      expect(resultOf(redirect)).toBe('failed');
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });

    it('refuses a return trip nobody signed, and still lands somewhere sensible', async () => {
      const redirect = await returnFromPlatform(
        'http://localhost:4000/api/ad-platforms/callback?state=forged',
      );

      const url = new URL(redirect);
      expect(url.pathname).toBe('/admin/campaigns');
      expect(url.searchParams.get('ad_platform_result')).toBe('failed');
      expect(await listConnections(fixture.admin.client)).toEqual([]);
    });

    it('keeps the grant when the accounts cannot be listed on the way back', async () => {
      const { returnUrl, providerRef } = await startConnection(
        fixture.admin.client,
        'meta',
      );
      provider.approve(providerRef, 'meta');
      // The grant lands, and the very next call — listing what it can see —
      // refuses. The merchant should not have to re-approve at Meta for that.
      const redirect = await returnFromPlatformWithListingDown(returnUrl);

      expect(resultOf(redirect)).toBe('choose_account');
      const [connection] = await listConnections(fixture.admin.client);
      expect(connection.status).toBe('awaiting_account');
    });

    /** Lets the grant through and fails the listing that follows it. */
    async function returnFromPlatformWithListingDown(
      returnUrl: string,
    ): Promise<string> {
      const original = provider.listAdAccounts.bind(provider);
      provider.listAdAccounts = () =>
        Promise.reject(new Error('upstream quota exceeded'));
      try {
        return await returnFromPlatform(returnUrl);
      } finally {
        provider.listAdAccounts = original;
      }
    }
  });

  // ─── The credential ─────────────────────────────────────────────────────────

  describe('the credential', () => {
    it('is never returned by a read', async () => {
      const { providerRef } = await approve(fixture.admin.client, 'meta');
      const secret = provider.credentialFor(fixture.storeId)?.secret;
      expect(secret).toBeTruthy();

      const res = await fixture.admin.client.get('/ad-platforms').expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(secret);
      expect(body).not.toContain(providerRef);
      expect(body).not.toContain('secret');
    });

    it('is sealed at rest, so the row does not hold the secret either', async () => {
      await approve(fixture.admin.client, 'meta');
      const secret = provider.credentialFor(fixture.storeId)!.secret;

      const [row] = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));

      expect(row.sealedSecret).toBeTruthy();
      expect(row.sealedSecret).not.toContain(secret);
      expect(row.sealedSecret!.startsWith('v1.')).toBe(true);
    });

    it('is kept while another platform on the same store still needs it', async () => {
      // Meta is the only platform this stage connects, so this pairing cannot
      // happen in production yet — the adapter refuses the others outright. It
      // is asserted through the fake because the rule it protects is the
      // service's, not the adapter's: destroying a Store's key while a second
      // grant still depends on it would strand that grant with no way back.
      const { providerRef } = await approve(fixture.admin.client, 'meta');
      await approve(fixture.admin.client, 'google');

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      expect(provider.disconnected).toHaveLength(1);
      expect(provider.revoked).toEqual([]);
      expect(provider.issued).toHaveLength(1);

      const [row] = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));
      expect(row.sealedSecret).toBeTruthy();
      expect(row.providerRef).toBe(providerRef);
    });

    it('is issued per store and not once for the organization', async () => {
      const second = await fixture.addStore();

      await approve(fixture.admin.client, 'meta');
      await approve(second.client, 'meta');

      expect(provider.issued).toHaveLength(2);
      const [first, other] = provider.issued;
      expect(first.storeId).toBe(fixture.storeId);
      expect(other.storeId).toBe(second.storeId);
      expect(first.secret).not.toBe(other.secret);
      expect(first.providerRef).not.toBe(other.providerRef);
    });
  });

  // ─── Seeing and revoking ────────────────────────────────────────────────────

  describe('what a store is connected to', () => {
    it("does not show one store's connection on another store in the same organization", async () => {
      const second = await fixture.addStore();
      await approve(fixture.admin.client, 'meta');

      expect(await listConnections(second.client)).toEqual([]);
    });

    it('lets two stores in one organization connect separately', async () => {
      const second = await fixture.addStore();

      await approve(fixture.admin.client, 'meta', [
        { externalAccountId: 'act_first', currency: 'USD' },
      ]);
      await approve(second.client, 'meta', [
        { externalAccountId: 'act_second', currency: 'USD' },
      ]);

      const [mine] = await listConnections(fixture.admin.client);
      const [theirs] = await listConnections(second.client);
      expect(mine.accountId).toBe('act_first');
      expect(theirs.accountId).toBe('act_second');
      expect(mine.id).not.toBe(theirs.id);
    });
  });

  describe('disconnecting', () => {
    it('keeps the connection so that nothing already pulled is rewritten', async () => {
      await approve(fixture.admin.client, 'meta');
      const [before] = await listConnections(fixture.admin.client);

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      const [after] = await listConnections(fixture.admin.client);
      // The same row, stopped — not a deletion, because figures will point at
      // this id and revoking access must not rewrite a past report.
      expect(after.id).toBe(before.id);
      expect(after.status).toBe('disconnected');
      expect(after.disconnectedAt).toBeTruthy();
      expect(after.connectedAt).toBe(before.connectedAt);
      expect(after.accountId).toBe(before.accountId);
      expect(after.pixelId).toBe(before.pixelId);
    });

    it('revokes access at the platform and destroys the credential', async () => {
      const { providerRef } = await approve(fixture.admin.client, 'meta');

      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      expect(provider.disconnected).toHaveLength(1);
      expect(provider.disconnected[0]).toMatchObject({
        providerRef,
        platform: 'meta',
      });
      expect(provider.revoked).toEqual([providerRef]);

      const [row] = await db
        .select()
        .from(adPlatformCredentials)
        .where(eq(adPlatformCredentials.storeId, fixture.storeId));
      expect(row.sealedSecret).toBeNull();
      expect(row.providerKeyRef).toBeNull();
      expect(row.revokedAt).toBeTruthy();
    });

    it('grants access again in place when the merchant reconnects', async () => {
      await approve(fixture.admin.client, 'meta');
      const [before] = await listConnections(fixture.admin.client);
      await fixture.admin.client
        .post('/ad-platforms/meta/disconnect')
        .expect(201);

      await approve(fixture.admin.client, 'meta');

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
      await approve(fixture.admin.client, 'meta');
      const other = await seedAdmin(app);

      try {
        expect(await listConnections(other.admin.client)).toEqual([]);
        // Not someone else's ad account, and not someone else's picker either.
        await other.admin.client
          .get('/ad-platforms/meta/ad-accounts')
          .expect(404);
        await other.admin.client
          .post('/ad-platforms/meta/account')
          .send({ accountId: 'act_sole' })
          .expect(404);
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
    it('lets a product manager read the connection but not grant or revoke access', async () => {
      await approve(fixture.admin.client, 'meta');
      const manager = await fixture.addUser('product_manager');

      // Reading which account produced the figures is part of reading the
      // campaigns page, so it asks for exactly what that page asks for.
      await manager.client.get('/ad-platforms').expect(200);

      await manager.client.post('/ad-platforms/google/connect').expect(403);
      await manager.client.get('/ad-platforms/meta/ad-accounts').expect(403);
      await manager.client
        .post('/ad-platforms/meta/account')
        .send({ accountId: 'act_sole' })
        .expect(403);
      await manager.client.post('/ad-platforms/meta/disconnect').expect(403);
    });

    it('rejects a request with no admin token at all', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/ad-platforms')
        .expect(401);
    });
  });

  describe('the platform argument', () => {
    it('refuses a platform that is not an ad platform at all', async () => {
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
