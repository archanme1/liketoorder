import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import { myPromotionSchema, type MyPromotion, type PromotionCategory } from './schema';

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
