import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { ads, unlinkedAds } from '../../../shared/database/schema';
import type {
  AdPlatform,
  UnlinkedAd,
  UnlinkedAdState,
} from '../../../shared/database/schema';
import type { PlatformAdSighting } from '../utils/unlinked-ad-plan.util';

/** One ad the sync is asking to hold, scoped to the connection that saw it. */
export interface UnlinkedAdSightingRow extends PlatformAdSighting {
  organizationId: string;
  storeId: string;
  connectionId: string;
  platform: AdPlatform;
}

/** The fields a transition writes beside the state itself. */
export interface TransitionPatch {
  claimedAdId?: string | null;
  claimedAt?: Date | null;
  dismissedAt?: Date | null;
}

/** How many rows go to the database in one statement, as the figures write does. */
const WRITE_CHUNK = 500;

/**
 * Unlinked Ads, always scoped to one Organization and one Store.
 *
 * Every method takes both and filters on both: an unlinked ad from another
 * tenant reads as absent, and a claim naming one cannot reach it.
 *
 * **`transition` is the only method in this codebase that writes
 * `unlinked_ads.state`.** Nothing else here updates it, and nothing outside
 * this file may: claim, dismiss, restore and unlink are four names for one
 * guarded write, and the guard is the `state = from` predicate on the update.
 * Two admins pressing Claim and Dismiss on the same row at the same moment is
 * not resolved by whichever read happened first — one of the two updates
 * matches no row and is refused.
 */
@Injectable()
export class UnlinkedAdRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findMany(
    orgId: string,
    storeId: string,
    state?: UnlinkedAdState,
  ): Promise<UnlinkedAd[]> {
    return this.db
      .select()
      .from(unlinkedAds)
      .where(
        and(
          eq(unlinkedAds.organizationId, orgId),
          eq(unlinkedAds.storeId, storeId),
          ...(state ? [eq(unlinkedAds.state, state)] : []),
        ),
      )
      .orderBy(desc(unlinkedAds.lastSeenAt), asc(unlinkedAds.externalAdId));
  }

  async findById(
    id: string,
    orgId: string,
    storeId: string,
  ): Promise<UnlinkedAd | null> {
    const [row] = await this.db
      .select()
      .from(unlinkedAds)
      .where(
        and(
          eq(unlinkedAds.id, id),
          eq(unlinkedAds.organizationId, orgId),
          eq(unlinkedAds.storeId, storeId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** How many are waiting on the merchant — the number surfaced on the page. */
  async countInState(
    orgId: string,
    storeId: string,
    state: UnlinkedAdState,
  ): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(unlinkedAds)
      .where(
        and(
          eq(unlinkedAds.organizationId, orgId),
          eq(unlinkedAds.storeId, storeId),
          eq(unlinkedAds.state, state),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /** Platform ad id → state, for every row this connection already holds. */
  async statesForConnection(
    connectionId: string,
  ): Promise<Map<string, UnlinkedAdState>> {
    const rows = await this.db
      .select({
        externalAdId: unlinkedAds.externalAdId,
        state: unlinkedAds.state,
      })
      .from(unlinkedAds)
      .where(eq(unlinkedAds.connectionId, connectionId));

    return new Map(rows.map((row) => [row.externalAdId, row.state]));
  }

  /**
   * Platform ad id → Ad id, for every Ad in this Store carrying one.
   *
   * A read of the `ads` table from here rather than a call into marketing,
   * because the question is this module's: which platform ads are already
   * spoken for. The partial unique index on `(store_id, external_id)` is what
   * lets the answer be a map rather than a list — at most one Ad may claim a
   * platform ad.
   */
  async adsByExternalId(
    orgId: string,
    storeId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: ads.id, externalId: ads.externalId })
      .from(ads)
      .where(
        and(
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
          isNotNull(ads.externalId),
        ),
      );

    return new Map(rows.map((row) => [row.externalId as string, row.id]));
  }

  /**
   * Holds what the sync saw, without touching what the merchant decided.
   *
   * The conflict clause updates the description — name, creative, flight, when
   * it was last seen — and deliberately lists neither `state` nor
   * `claimed_ad_id`. That omission is the whole of "a dismissed ad does not
   * come back on the next sync": the sync meets the same ad on every run by
   * design, and this write is the point where it either asks the merchant a new
   * question or refreshes one they have already answered.
   */
  async holdMany(rows: UnlinkedAdSightingRow[], seenAt: Date): Promise<number> {
    if (rows.length === 0) return 0;

    for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
      const chunk = rows.slice(start, start + WRITE_CHUNK);
      await this.db
        .insert(unlinkedAds)
        .values(
          chunk.map((row) => ({
            ...row,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
            updatedAt: seenAt,
          })),
        )
        .onConflictDoUpdate({
          target: [unlinkedAds.connectionId, unlinkedAds.externalAdId],
          set: {
            name: sql`excluded.name`,
            creativeUrl: sql`excluded.creative_url`,
            startsAt: sql`excluded.starts_at`,
            endsAt: sql`excluded.ends_at`,
            lastSeenAt: seenAt,
            updatedAt: seenAt,
          },
        });
    }

    return rows.length;
  }

  /**
   * Moves one row from one state to another, or answers null.
   *
   * `from` is part of the predicate rather than something the caller checked a
   * moment ago. A row that has moved since the caller read it matches nothing
   * and the update writes nothing — which the service turns into the refusal
   * the merchant reads, instead of overwriting a decision somebody else just
   * made.
   */
  async transition(
    id: string,
    orgId: string,
    storeId: string,
    from: UnlinkedAdState,
    to: UnlinkedAdState,
    patch: TransitionPatch,
    at: Date,
  ): Promise<UnlinkedAd | null> {
    const [row] = await this.db
      .update(unlinkedAds)
      .set({ ...patch, state: to, updatedAt: at })
      .where(
        and(
          eq(unlinkedAds.id, id),
          eq(unlinkedAds.organizationId, orgId),
          eq(unlinkedAds.storeId, storeId),
          eq(unlinkedAds.state, from),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * The same guarded transition, addressed by platform ad id rather than by
   * row id — what the sync's own reconciliation uses, since it is looking at a
   * tree keyed that way and not at rows a merchant clicked.
   */
  async transitionByExternalId(
    connectionId: string,
    externalAdId: string,
    from: UnlinkedAdState,
    to: UnlinkedAdState,
    patch: TransitionPatch,
    at: Date,
  ): Promise<UnlinkedAd | null> {
    const [row] = await this.db
      .update(unlinkedAds)
      .set({ ...patch, state: to, updatedAt: at })
      .where(
        and(
          eq(unlinkedAds.connectionId, connectionId),
          eq(unlinkedAds.externalAdId, externalAdId),
          eq(unlinkedAds.state, from),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Rows pointing at Ads, for a read that needs their names. */
  async adNamesById(
    adIds: string[],
    orgId: string,
    storeId: string,
  ): Promise<Map<string, { name: string; tag: string; campaignId: string }>> {
    if (adIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        id: ads.id,
        name: ads.name,
        tag: ads.tag,
        campaignId: ads.campaignId,
      })
      .from(ads)
      .where(
        and(
          inArray(ads.id, adIds),
          eq(ads.organizationId, orgId),
          eq(ads.storeId, storeId),
        ),
      );

    return new Map(
      rows.map((row) => [
        row.id,
        { name: row.name, tag: row.tag, campaignId: row.campaignId },
      ]),
    );
  }
}
