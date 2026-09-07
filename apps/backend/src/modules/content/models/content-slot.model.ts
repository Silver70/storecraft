import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { contentSlotTypeEnum } from '../../../shared/database/schema';
import type { ContentSlotType } from '../../../shared/database/schema';

/** The database enum, said in the shape GraphQL wants to publish it. */
export const ContentSlotTypes = Object.fromEntries(
  contentSlotTypeEnum.enumValues.map((value) => [value, value]),
) as Record<ContentSlotType, ContentSlotType>;

registerEnumType(ContentSlotTypes, {
  name: 'ContentSlotType',
  description: 'The shape of a content slot’s content.',
});

/**
 * A published Content Slot, as a shopper's browser may see it.
 *
 * There is deliberately no draft field on this type. The public API is the
 * surface a shopper can reach, and a field that does not exist cannot be asked
 * for — a stronger guarantee than a filter someone has to remember to apply.
 */
@ObjectType('ContentSlot')
export class ContentSlotModel {
  @Field(() => String, {
    description: 'The stable key the storefront renders this region at.',
  })
  declare key: string;

  @Field(() => ContentSlotTypes)
  declare type: ContentSlotType;

  @Field(() => String, { description: 'The published value. Never a draft.' })
  declare value: string;
}
