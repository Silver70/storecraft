import { InputType, ObjectType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, IsDate, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ATTRIBUTION_LIMITS } from '../../../shared/database/schema';
import type { AttributionSnapshot } from '../../../shared/attribution/attribution.types';

/**
 * One arrival, as the storefront saw it. Every field is optional: a storefront
 * that knows nothing sends nothing, and a Touch carrying no UTM value and no
 * referrer is treated as direct and recorded as no evidence at all.
 */
@InputType()
export class AttributionTouchInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.utm)
  declare utmSource?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.utm)
  declare utmMedium?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.utm)
  declare utmCampaign?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.utm)
  declare utmContent?: string;

  @Field(() => String, { nullable: true, description: 'Full referring URL' })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.referrer)
  declare referrer?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Path the visitor landed on, e.g. /products/desk-fan',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.landingPath)
  declare landingPath?: string;

  @Field(() => Date, {
    nullable: true,
    description:
      'When the arrival happened. Defaults to now — pass it when replaying a ' +
      'first touch the storefront stored on an earlier visit.',
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  declare occurredAt?: Date;
}

/**
 * Where a visitor came from, as declared by the storefront on cart creation.
 *
 * Optional in full: omitting it degrades campaign reporting and never fails a
 * mutation. Per ADR-0001 a declared value is authoritative — the system only
 * falls back to inferring attribution from tracked events when none is passed.
 */
@InputType()
export class CartAttributionInput {
  @Field(() => AttributionTouchInput, {
    nullable: true,
    description: 'The visitor’s earliest known arrival. Write-once.',
  })
  @IsOptional()
  @Type(() => AttributionTouchInput)
  declare firstTouch?: AttributionTouchInput;

  @Field(() => AttributionTouchInput, {
    nullable: true,
    description: 'The arrival that led to this cart. Advances on each new one.',
  })
  @IsOptional()
  @Type(() => AttributionTouchInput)
  declare lastTouch?: AttributionTouchInput;

  @Field(() => String, {
    nullable: true,
    description: 'Anonymous visitor id, stable across sessions',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.visitorId)
  declare visitorId?: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Current session id. Matches the tracking script’s session so ' +
      'attribution can be correlated from events when none is declared.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTION_LIMITS.sessionId)
  declare sessionId?: string;
}

@ObjectType()
export class AttributionTouchType {
  @Field(() => String, { nullable: true })
  declare utmSource?: string | null;

  @Field(() => String, { nullable: true })
  declare utmMedium?: string | null;

  @Field(() => String, { nullable: true })
  declare utmCampaign?: string | null;

  @Field(() => String, { nullable: true })
  declare utmContent?: string | null;

  @Field(() => String, { nullable: true })
  declare referrer?: string | null;

  @Field(() => String, { nullable: true })
  declare landingPath?: string | null;

  @Field(() => Date, { nullable: true })
  declare occurredAt?: Date | null;
}

@ObjectType()
export class CartAttributionType {
  @Field(() => String, {
    description:
      'declared (passed by the storefront) | correlated (inferred from ' +
      'events) | none (unattributed)',
  })
  declare source: string;

  @Field(() => AttributionTouchType, { nullable: true })
  declare firstTouch?: AttributionTouchType | null;

  @Field(() => AttributionTouchType, { nullable: true })
  declare lastTouch?: AttributionTouchType | null;

  @Field(() => String, { nullable: true })
  declare visitorId?: string | null;

  @Field(() => String, { nullable: true })
  declare sessionId?: string | null;
}

/**
 * Reshapes the flat column group into the nested touches the API exposes. A
 * touch that was never recorded is null rather than an object of nulls, so a
 * storefront can tell "no evidence" from "direct arrival" at a glance.
 */
export function toCartAttributionType(
  snapshot: AttributionSnapshot,
): CartAttributionType {
  return {
    source: snapshot.attributionSource,
    visitorId: snapshot.visitorId,
    sessionId: snapshot.sessionId,
    firstTouch:
      snapshot.firstTouchAt === null
        ? null
        : {
            utmSource: snapshot.firstTouchUtmSource,
            utmMedium: snapshot.firstTouchUtmMedium,
            utmCampaign: snapshot.firstTouchUtmCampaign,
            utmContent: snapshot.firstTouchUtmContent,
            referrer: snapshot.firstTouchReferrer,
            landingPath: snapshot.firstTouchLandingPath,
            occurredAt: snapshot.firstTouchAt,
          },
    lastTouch:
      snapshot.lastTouchAt === null
        ? null
        : {
            utmSource: snapshot.lastTouchUtmSource,
            utmMedium: snapshot.lastTouchUtmMedium,
            utmCampaign: snapshot.lastTouchUtmCampaign,
            utmContent: snapshot.lastTouchUtmContent,
            referrer: snapshot.lastTouchReferrer,
            landingPath: snapshot.lastTouchLandingPath,
            occurredAt: snapshot.lastTouchAt,
          },
  };
}
