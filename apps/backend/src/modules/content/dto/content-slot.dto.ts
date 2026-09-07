import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  CONTENT_SLOT_LIMITS,
  CONTENT_SLOT_RAW_LIMIT,
  contentSlotTypeEnum,
} from '../../../shared/database/schema';
import type { ContentSlotType } from '../../../shared/database/schema';

const TYPES = contentSlotTypeEnum.enumValues;
/** Dotted lowercase segments — `homepage.hero`. A name, not a path. */
const SLOT_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * The Slot key in the URL, validated as a name so a key can never be a path
 * traversal or a stray uppercase variant of a Slot that already exists.
 */
export class ContentSlotKeyParamDto {
  @ApiProperty({ example: 'homepage.hero' })
  @IsString()
  @MaxLength(CONTENT_SLOT_LIMITS.key)
  @Matches(SLOT_KEY, {
    message:
      'A slot key is lowercase words separated by dots or dashes, like "homepage.hero".',
  })
  declare key: string;
}

/**
 * The type comes from the storefront's own declaration of the region, relayed
 * by the editor, which is what keeps a Slot's content the shape the storefront
 * asked for rather than whatever the last write happened to be.
 */
export class SaveContentSlotDraftDto {
  @ApiProperty({ enum: TYPES, example: 'heading' })
  @IsEnum(TYPES)
  declare type: ContentSlotType;

  @ApiProperty({ example: 'Winter kit, ready when you are.' })
  @IsString()
  // The value is reduced to text before it is measured against the limit its
  // type carries; this only stops an unbounded body from getting that far.
  @MaxLength(CONTENT_SLOT_RAW_LIMIT)
  declare value: string;
}
