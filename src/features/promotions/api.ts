import type { PostgrestError } from '@supabase/supabase-js';

import type { SnappedPoint } from '@/features/map/region';
import { supabase } from '@/lib/supabase';

import {
  myPromotionSchema,
  offersPageSchema,
  type MyPromotion,
  type OfferFilters,
  type OffersPage,
  type PromotionCategory,
} from './schema';

export type PromotionErrorCode =
  | 'not_authenticated'
  | 'not_eligible'
  | 'not_configured'
  | 'already_open'
  | 'too_many_requests'
  | 'invalid_headline'
  | 'invalid_category'
  | 'invalid_start'
  | 'not_found'
  | 'not_cancellable'
  | 'contact_support'
  | 'network'
  | 'unknown';

// Carries only a code, never the headline or the upstream message.
export class PromotionAppError extends Error {
  readonly code: PromotionErrorCode;

  constructor(code: PromotionErrorCode) {
    super(code);
    this.name = 'PromotionAppError';
    this.code = code;
  }
}

// Codes raised by request_promotion and cancel_my_promotion (raise exception '<code>').
const KNOWN_CODES: Record<string, PromotionErrorCode> = {
  not_authenticated: 'not_authenticated',
  not_eligible: 'not_eligible',
  not_configured: 'not_configured',
  already_open: 'already_open',
  too_many_requests: 'too_many_requests',
  invalid_headline: 'invalid_headline',
  invalid_category: 'invalid_category',
  invalid_start: 'invalid_start',
  not_found: 'not_found',
  not_cancellable: 'not_cancellable',
  // Spec 16b: cancel_my_promotion refuses a paid campaign.
  contact_support: 'contact_support',
};

/** Maps a PostgREST / RPC error. A bad uuid (22P02) is not_found: no such promotion. */
export function mapPromotionError(error: unknown): PromotionAppError {
  if (error instanceof PromotionAppError) return error;
  if (!error || typeof error !== 'object') return new PromotionAppError('unknown');
  // details can be null at runtime, and a destructuring default only covers undefined.
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  // Own keys only: "constructor" or "toString" must not count as codes.
  if (code === 'P0001' && Object.hasOwn(KNOWN_CODES, message)) {
    return new PromotionAppError(KNOWN_CODES[message]);
  }
  if (code === '22P02') return new PromotionAppError('not_found');
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new PromotionAppError('network');
  }
  return new PromotionAppError('unknown');
}

function parse(data: unknown): MyPromotion {
  const parsed = myPromotionSchema.safeParse(data);
  if (!parsed.success) throw new PromotionAppError('unknown');
  return parsed.data;
}

// The generated RPC types mark every argument non-null, but p_preferred_start takes null ("as
// soon as possible"). This keeps the null without an `any`.
function nullable<T>(value: T | null): T {
  return value as T;
}

/** The caller's latest campaign, the current settings and whether the business may ask now. */
export async function fetchMyPromotion(): Promise<MyPromotion> {
  const { data, error } = await supabase.rpc('get_my_promotion');
  if (error) throw mapPromotionError(error);
  return parse(data);
}

export type PromotionRequest = {
  category: PromotionCategory;
  /** Already checked and trimmed (checkHeadline): the server refuses edge spaces. */
  headline: string;
  /** YYYY-MM-DD, or null for "as soon as possible". */
  preferredStart: string | null;
};

/** Sends a request. Answers with the same object as fetchMyPromotion. */
export async function requestPromotion(request: PromotionRequest): Promise<MyPromotion> {
  const { data, error } = await supabase.rpc('request_promotion', {
    p_category: request.category,
    p_headline: request.headline,
    p_preferred_start: nullable(request.preferredStart),
  });
  if (error) throw mapPromotionError(error);
  return parse(data);
}

/** Cancels the caller's requested, scheduled or active campaign. Same answer as fetchMyPromotion. */
export async function cancelMyPromotion(promotionId: string): Promise<MyPromotion> {
  const { data, error } = await supabase.rpc('cancel_my_promotion', {
    p_promotion_id: promotionId,
  });
  if (error) throw mapPromotionError(error);
  return parse(data);
}

// -- Offers (spec 16 PR 4) -----------------------------------------------------------------

export type OfferErrorCode =
  | 'invalid_point'
  | 'invalid_distance'
  | 'invalid_filter'
  | 'invalid_cursor'
  | 'rate_limited'
  | 'network'
  | 'unknown';

// Carries only a code: never the point, a filter or the upstream message.
export class OfferAppError extends Error {
  readonly code: OfferErrorCode;

  constructor(code: OfferErrorCode) {
    super(code);
    this.name = 'OfferAppError';
    this.code = code;
  }
}

// Every name list_offers_near (and consume_map_quota inside it) raises.
const OFFER_CODES: Record<string, OfferErrorCode> = {
  invalid_point: 'invalid_point',
  invalid_distance: 'invalid_distance',
  invalid_filter: 'invalid_filter',
  invalid_cursor: 'invalid_cursor',
  rate_limited: 'rate_limited',
};

/** Maps a PostgREST / RPC error. Anything not raised by name (a timeout, say) is unknown. */
export function mapOfferError(error: unknown): OfferAppError {
  if (error instanceof OfferAppError) return error;
  if (!error || typeof error !== 'object') return new OfferAppError('unknown');
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  if (code === 'P0001' && Object.hasOwn(OFFER_CODES, message)) {
    return new OfferAppError(OFFER_CODES[message]);
  }
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new OfferAppError('network');
  }
  return new OfferAppError('unknown');
}

/**
 * One page of active promotions near a grid point. Only the snapped point's two numbers are sent,
 * in the body of a POST (supabase.rpc's default: no options argument, so never a GET whose URL
 * would carry them). `cursor` is the previous page's next_cursor, sent back untouched.
 */
export async function fetchOffersNear(
  point: SnappedPoint,
  filters: OfferFilters,
  cursor: string | null,
): Promise<OffersPage> {
  const { data, error } = await supabase.rpc('list_offers_near', {
    p_lat: point.lat,
    p_lng: point.lng,
    p_distance_km: filters.distanceKm,
    p_category: nullable(filters.category),
    p_type: nullable(filters.type),
    p_tables: filters.tables,
    p_cursor: nullable(cursor),
  });
  if (error) throw mapOfferError(error);
  const parsed = offersPageSchema.safeParse(data);
  if (!parsed.success) throw new OfferAppError('unknown');
  return parsed.data;
}
