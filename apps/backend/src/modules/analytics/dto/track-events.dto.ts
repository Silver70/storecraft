import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Open taxonomy at the DB layer (event_type is varchar), but the ingest DTO
// still allowlists known names so garbage can't be injected. `custom` is the
// escape hatch: send `type: 'custom'` + an `eventName` for anything bespoke.
export const ANALYTICS_EVENT_TYPES = [
  // Funnel (Phase 2)
  'page_view',
  'product_view',
  'add_to_cart',
  'checkout_start',
  'purchase',
  // Behavioral (Phase 3)
  'session_start',
  'click',
  'form_submit',
  'custom',
] as const;

export type AnalyticsEventTypeDto = (typeof ANALYTICS_EVENT_TYPES)[number];

/** One tracked storefront event. All fields except type + sessionId optional. */
export class TrackEventDto {
  @IsEnum(ANALYTICS_EVENT_TYPES)
  declare type: AnalyticsEventTypeDto;

  /** Caller-managed visitor/session id — the unit of unique-visitor + funnel. */
  @IsString()
  @MaxLength(128)
  declare sessionId: string;

  /** Persistent anonymous visitor id (survives across sessions). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  visitorId?: string;

  /** Human label for click / custom events, e.g. "Add to cart button". */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  eventName?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  /**
   * Which creative was clicked — the Ad Tag half of the pair per-Ad traffic is
   * joined on. Optional like every other tag: a storefront that sends nothing
   * here reports against its Campaign and against no Ad, which is what an
   * untagged link means.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmContent?: string;

  /**
   * Arbitrary caller attributes + click/form detail (element tag, text, href,
   * form id, field names — never field values). Stored verbatim as jsonb.
   */
  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  /** Client-side event time (ISO-8601). Defaults to ingest time when omitted. */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

/** Batch envelope — send many events in one request to stay under rate limits. */
export class TrackEventsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  declare events: TrackEventDto[];
}
