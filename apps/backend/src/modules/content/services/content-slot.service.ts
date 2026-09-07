import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CONTENT_SLOT_VALUE_LIMITS,
  type ContentSlot,
  type ContentSlotType,
} from '../../../shared/database/schema';
import {
  ContentSlotRepository,
  type PublishedSlot,
} from '../repositories/content-slot.repository';
import { toSlotText } from '../utils/slot-text.util';

export interface SaveSlotDraftInput {
  /** The shape the storefront declared for this region. */
  type: ContentSlotType;
  value: string;
}

/**
 * Content Slots: the named regions a storefront renders at stable keys.
 *
 * A Slot edit is drafted and published separately, deliberately unlike an
 * entity field, which is live the moment it is committed. The published value
 * keeps rendering to shoppers for as long as a draft exists, so editing never
 * blanks a live region — and the draft has no path to the public read at all.
 */
@Injectable()
export class ContentSlotService {
  constructor(private readonly slots: ContentSlotRepository) {}

  list(orgId: string, storeId: string): Promise<ContentSlot[]> {
    return this.slots.findMany(orgId, storeId);
  }

  /**
   * What a shopper may see. Published values only, and there is no argument to
   * this that changes that: a draft reaching a shopper is a merchant's
   * unfinished words on their live Store, discovered by a customer rather than
   * by them, and nothing afterwards un-shows it.
   */
  listPublished(orgId: string, storeId: string): Promise<PublishedSlot[]> {
    return this.slots.findPublished(orgId, storeId);
  }

  /**
   * Saves the merchant's unpublished work, creating the Slot on the first edit
   * of a region the storefront declares. The published value is not touched.
   */
  async saveDraft(
    key: string,
    input: SaveSlotDraftInput,
    orgId: string,
    storeId: string,
  ): Promise<ContentSlot> {
    const value = toSlotText(input.value, input.type);
    const limit = CONTENT_SLOT_VALUE_LIMITS[input.type];
    if (value.length > limit) {
      throw new BadRequestException(
        `A ${input.type} slot can hold at most ${limit} characters. Nothing was saved — shorten it and try again.`,
      );
    }
    return this.slots.saveDraft(key, input.type, value, orgId, storeId);
  }

  /**
   * Makes the drafted value the one shoppers see. Publishing is its own
   * action, so going live is a decision rather than a side effect of typing.
   */
  async publish(
    key: string,
    orgId: string,
    storeId: string,
  ): Promise<ContentSlot> {
    const slot = await this.slots.findByKey(key, orgId, storeId);
    if (!slot) {
      throw new BadRequestException(`No content slot named "${key}".`);
    }
    if (slot.draftValue === null) {
      throw new BadRequestException(
        `"${key}" has no draft to publish. Save a draft first.`,
      );
    }
    const published = await this.slots.publish(
      key,
      orgId,
      storeId,
      slot.draftValue,
    );
    // The row was there a moment ago and this Store owns it; a null here can
    // only mean it was removed underneath us, which is not a publish failure
    // worth inventing a state for.
    if (!published) {
      throw new BadRequestException(`No content slot named "${key}".`);
    }
    return published;
  }
}
