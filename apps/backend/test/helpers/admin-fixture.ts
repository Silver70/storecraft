/**
 * Seeds what an admin session needs — an Organization, a Store, and admin users
 * holding real roles — and removes all of it afterwards.
 *
 * Tokens are minted by the real `AdminAuthService.login`, so the guard under
 * test verifies a token issued exactly the way a merchant's is. Teardown deletes
 * the Organization, which every tenant-scoped table cascades from, and then the
 * admin users, which are global identities and so cascade from nothing.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { eq, inArray } from 'drizzle-orm';
import type { App } from 'supertest/types';
import {
  DRIZZLE_CLIENT,
  type DrizzleClient,
} from '../../src/shared/database/database.module';
import { AdminAuthService } from '../../src/modules/auth/services/admin-auth.service';
import {
  adminUsers,
  organizationMembers,
  organizations,
  stores,
} from '../../src/shared/database/schema';
import type { TenantContext } from '../../src/shared/tenant/tenant-context';
import { TEST_ADMIN_EMAIL_DOMAIN, TEST_ORG_SLUG_PREFIX } from './test-env';
import { AdminClient } from './admin-client';

type AdminRole = NonNullable<TenantContext['role']>;

const PASSWORD = 'e2e-admin-password';
// Cost 4, not the production 12: `login` reads the cost from the hash, so the
// real comparison still runs — just without spending a quarter of a second per
// fixture user proving bcrypt works.
const BCRYPT_TEST_ROUNDS = 4;

export interface AdminUserFixture {
  id: string;
  email: string;
  role: AdminRole;
  accessToken: string;
  /** An admin API client already authenticated as this user and store. */
  client: AdminClient;
}

export interface AdminFixture {
  organizationId: string;
  storeId: string;
  /** The organization owner. */
  admin: AdminUserFixture;
  /** Adds another admin to this same organization, holding `role`. */
  addUser(role: AdminRole): Promise<AdminUserFixture>;
  /**
   * Adds a second Store to this organization and returns the owner's client
   * pointed at it — for asserting that store-scoped data does not leak between
   * two stores the same admin can legitimately reach.
   */
  addStore(): Promise<{ storeId: string; client: AdminClient }>;
}

export async function seedAdmin(
  app: INestApplication<App>,
): Promise<AdminFixture> {
  const db = app.get<DrizzleClient>(DRIZZLE_CLIENT);
  const auth = app.get(AdminAuthService);
  const unique = randomUUID().slice(0, 8);

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `E2E Admin Org ${unique}`,
      slug: `${TEST_ORG_SLUG_PREFIX}${unique}`,
    })
    .returning();

  const [store] = await db
    .insert(stores)
    .values({
      organizationId: organization.id,
      name: `E2E Store ${unique}`,
      slug: `store-${unique}`,
    })
    .returning();

  async function addUser(role: AdminRole): Promise<AdminUserFixture> {
    const email = `${role}-${randomUUID().slice(0, 8)}@${TEST_ADMIN_EMAIL_DOMAIN}`;
    const [user] = await db
      .insert(adminUsers)
      .values({
        email,
        passwordHash: await bcrypt.hash(PASSWORD, BCRYPT_TEST_ROUNDS),
        emailVerified: true,
      })
      .returning();

    await db.insert(organizationMembers).values({
      organizationId: organization.id,
      adminUserId: user.id,
      role,
    });

    const session = await auth.login(email, PASSWORD);
    return {
      id: user.id,
      email,
      role,
      accessToken: session.accessToken,
      client: new AdminClient(app, session.accessToken, store.id),
    };
  }

  const admin = await addUser('super_admin');

  async function addStore(): Promise<{
    storeId: string;
    client: AdminClient;
  }> {
    const suffix = randomUUID().slice(0, 8);
    const [extra] = await db
      .insert(stores)
      .values({
        organizationId: organization.id,
        name: `E2E Store ${suffix}`,
        slug: `store-${suffix}`,
      })
      .returning();

    return {
      storeId: extra.id,
      client: new AdminClient(app, admin.accessToken, extra.id),
    };
  }

  return {
    organizationId: organization.id,
    storeId: store.id,
    admin,
    addUser,
    addStore,
  };
}

/** Removes a fixture, everything created under it, and its admin identities. */
export async function destroyAdmin(
  app: INestApplication<App>,
  fixture: AdminFixture,
): Promise<void> {
  const db = app.get<DrizzleClient>(DRIZZLE_CLIENT);

  // Read the members back before the cascade removes them: the users themselves
  // live outside the organization and have to be named explicitly.
  const members = await db
    .select({ adminUserId: organizationMembers.adminUserId })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, fixture.organizationId));

  await db
    .delete(organizations)
    .where(eq(organizations.id, fixture.organizationId));

  if (members.length > 0) {
    await db.delete(adminUsers).where(
      inArray(
        adminUsers.id,
        members.map((m) => m.adminUserId),
      ),
    );
  }
}
