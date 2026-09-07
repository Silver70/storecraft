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
    const existing = await this.slots.findByKey(key, orgId, storeId);
    // A Slot's type is declared once, by the storefront that renders the
    // region, and every later write is measured against it. Without this a
    // heading Slot could acquire a two-thousand-character value by claiming to
    // be a text one, and the storefront would be asked to render something it
    // has no layout for. A region whose shape genuinely changes is a different
    // region and gets a different key: copy written for a headline is not the
    // copy for a paragraph.
    if (existing && existing.type !== input.type) {
      throw new BadRequestException(
        `"${key}" is a ${existing.type} region, so it cannot hold ${input.type} content. Nothing was saved.`,
      );
    }
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
   * Throws away the merchant's unpublished work, leaving what shoppers are
   * reading exactly as it was. Abandoning an idea is one action, so trying a
   * headline costs nothing.
   *
   * Discarding a Slot that has no draft is not an error: the outcome the
   * merchant asked for already holds, and reporting a failure for it would only
   * teach them to distrust the button.
   */
  async discardDraft(
    key: string,
    orgId: string,
    storeId: string,
  ): Promise<ContentSlot> {
    const slot = await this.slots.findByKey(key, orgId, storeId);
    if (!slot) {
      throw new BadRequestException(`No content slot named "${key}".`);
    }
    if (slot.draftValue === null) return slot;
    // A Slot that has never been published goes back to having nothing in it
    // at all, which is the state it started in and the state that renders
    // nothing to a shopper.
    const discarded = await this.slots.discardDraft(
      key,
      orgId,
      storeId,
      slot.value === null ? 'draft' : 'published',
    );
    if (!discarded) {
      throw new BadRequestException(`No content slot named "${key}".`);
    }
    return discarded;
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
