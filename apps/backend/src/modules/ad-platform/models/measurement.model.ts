import { ObjectType, Field } from '@nestjs/graphql';

/**
 * What a storefront needs in order to measure — or, far more often, in order to
 * know that it must not.
 *
 * Read on every page by a script anyone can view the source of, so it carries
 * only what is already public the moment the Pixel loads: the Pixel's id, which
 * appears in the network request it makes, and whether a banner is required.
 * The ad account, the credential and every figure stay on the admin side of the
 * API.
 */
@ObjectType('MeasurementSettings')
export class MeasurementSettingsModel {
  @Field(() => String, {
    nullable: true,
    description:
      'The Pixel to load, from the ad account this store has connected. Null ' +
      'when no ad platform is connected, which is what makes connecting — and ' +
      'disconnecting — switch measurement on and off without a deploy.',
  })
  declare pixelId: string | null;

  @Field(() => Boolean, {
    description:
      'Whether this store asks visitors before measuring anything. False ' +
      'unless the merchant turned it on, so a store that needs no banner ' +
      'shows none.',
  })
  declare consentRequired: boolean;
}
