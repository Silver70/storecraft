import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { DrizzleClient } from '../../../shared/database/database.module';
import { DRIZZLE_CLIENT } from '../../../shared/database/database.module';
import type {
  ContentSlot,
  ContentSlotStatus,
  ContentSlotType,
} from '../../../shared/database/schema';
import { contentSlots } from '../../../shared/database/schema';

/** What a shopper's browser may learn about a Slot: its key, shape, and copy. */
export interface PublishedSlot {
  key: string;
  type: ContentSlotType;
  value: string;
}

/**
 * Every method takes the organization and store explicitly and filters on
 * both, before a key is ever matched. A Slot belongs to one Store, so the same
 * key in two Stores is two different Slots and neither can read the other.
 */
@Injectable()
export class ContentSlotRepository {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findMany(orgId: string, storeId: string): Promise<ContentSlot[]> {
    return this.db
      .select()
      .from(contentSlots)
      .where(
        and(
          eq(contentSlots.organizationId, orgId),
          eq(contentSlots.storeId, storeId),
        ),
      )
      .orderBy(asc(contentSlots.key));
  }

  async findByKey(
    key: string,
    orgId: string,
    storeId: string,
  ): Promise<ContentSlot | null> {
    const [row] = await this.db
      .select()
      .from(contentSlots)
      .where(
        and(
          eq(contentSlots.organizationId, orgId),
          eq(contentSlots.storeId, storeId),
          eq(contentSlots.key, key),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * The only read the public storefront API has. It selects the published
   * columns and nothing else, and skips a Slot that has never been published —
   * so a draft has no path out of here, whatever the caller asks for.
   */
  async findPublished(
    orgId: string,
    storeId: string,
  ): Promise<PublishedSlot[]> {
    const rows = await this.db
      .select({
        key: contentSlots.key,
        type: contentSlots.type,
        value: contentSlots.value,
      })
      .from(contentSlots)
      .where(
        and(
          eq(contentSlots.organizationId, orgId),
          eq(contentSlots.storeId, storeId),
          isNotNull(contentSlots.value),
        ),
      )
      .orderBy(asc(contentSlots.key));
    return rows.map((row) => ({ ...row, value: row.value ?? '' }));
  }

  /**
   * Writes the draft, creating the Slot the first time the merchant edits a
   * region their storefront declares. The published value is untouched: a
   * failed or half-finished draft can never destroy copy that is already live.
   */
  async saveDraft(
    key: string,
    type: ContentSlotType,
    draftValue: string,
    orgId: string,
    storeId: string,
  ): Promise<ContentSlot> {
    const [row] = await this.db
      .insert(contentSlots)
      .values({
        organizationId: orgId,
        storeId,
        key,
        type,
        draftValue,
        status: 'draft',
      })
      .onConflictDoUpdate({
        target: [contentSlots.storeId, contentSlots.key],
        set: {
          type,
          draftValue,
          status: 'draft',
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /**
   * Throws the draft away. The published value and the time it was published
   * are deliberately untouched: abandoning an idea is one action, and it can
   * never be the action that takes a Store's live copy down with it.
   */
  async discardDraft(
    key: string,
    orgId: string,
    storeId: string,
    status: ContentSlotStatus,
  ): Promise<ContentSlot | null> {
    const [row] = await this.db
      .update(contentSlots)
      .set({ draftValue: null, status, updatedAt: new Date() })
      .where(
        and(
          eq(contentSlots.organizationId, orgId),
          eq(contentSlots.storeId, storeId),
          eq(contentSlots.key, key),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Moves the draft into the published value and clears it. */
  async publish(
    key: string,
    orgId: string,
    storeId: string,
    value: string,
  ): Promise<ContentSlot | null> {
    const [row] = await this.db
      .update(contentSlots)
      .set({
        value,
        draftValue: null,
        status: 'published',
        lastPublishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentSlots.organizationId, orgId),
          eq(contentSlots.storeId, storeId),
          eq(contentSlots.key, key),
        ),
      )
      .returning();
    return row ?? null;
  }
}
