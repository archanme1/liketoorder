import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type PostgrestError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import {
  myBusinessSchema,
  placeSuggestionsResponseSchema,
  type BusinessType,
  type EditFormValues,
  type MyBusiness,
  type PlaceSuggestion,
} from './schema';

export type SellerErrorCode =
  | 'already_has_business'
  | 'no_business'
  | 'profile_incomplete'
  | 'rate_limited'
  | 'not_a_place'
  | 'invalid_input'
  | 'network'
  | 'unknown';

// Carries only a code. Never the address text, place ID, coordinates or the upstream message,
// so nothing private ends up in logs or error output.
export class SellerAppError extends Error {
  readonly code: SellerErrorCode;

  constructor(code: SellerErrorCode) {
    super(code);
    this.name = 'SellerAppError';
    this.code = code;
  }
}

// Codes raised by the seller functions (raise exception '<code>') and the Edge Functions' { error: { code } }.
const KNOWN_CODES: Record<string, SellerErrorCode> = {
  already_has_business: 'already_has_business',
  no_business: 'no_business',
  profile_incomplete: 'profile_incomplete',
  tables_restaurant_only: 'invalid_input',
  rate_limited: 'rate_limited',
  not_a_place: 'not_a_place',
  invalid_input: 'invalid_input',
};

/** Maps a PostgREST / RPC error. Constraint failures (23514 check, 23503 cuisine FK) are invalid input. */
export function mapSellerError(error: unknown): SellerAppError {
  if (error instanceof SellerAppError) return error;
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new SellerAppError('network');
  }
  if (!error || typeof error !== 'object') return new SellerAppError('unknown');
  // details can be null at runtime, and a destructuring default only covers undefined.
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  if (code === 'P0001' && message in KNOWN_CODES) return new SellerAppError(KNOWN_CODES[message]);
  if (code === '23514' || code === '23503' || code === '22P02') {
    return new SellerAppError('invalid_input');
  }
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new SellerAppError('network');
  }
  return new SellerAppError('unknown');
}

/** Maps an Edge Function error, reading the { error: { code } } body when there is one. */
export async function mapFunctionError(error: unknown): Promise<SellerAppError> {
  if (!(error instanceof FunctionsHttpError)) return mapSellerError(error);
  const response: unknown = error.context;
  if (!(response instanceof Response)) return new SellerAppError('unknown');
  if (response.status === 429) return new SellerAppError('rate_limited');
  try {
    const body: unknown = await response.json();
    const code =
      body && typeof body === 'object' && 'error' in body
        ? (body.error as { code?: unknown } | null)?.code
        : undefined;
    if (typeof code === 'string' && code in KNOWN_CODES)
      return new SellerAppError(KNOWN_CODES[code]);
  } catch {
    // Unreadable body: fall through.
  }
  return new SellerAppError('unknown');
}

function parseBusiness(data: unknown): MyBusiness {
  const parsed = myBusinessSchema.safeParse(data);
  if (!parsed.success) throw new SellerAppError('unknown');
  return parsed.data;
}

/** The caller's own business (owner view, including their exact address), or null. */
export async function getMyBusiness(): Promise<MyBusiness | null> {
  const { data, error } = await supabase.rpc('get_my_business');
  if (error) throw mapSellerError(error);
  return data === null ? null : parseBusiness(data);
}

export type CreateBusinessInput = {
  type: BusinessType;
  name: string;
  cuisine_code: string;
  accepts_table_requests: boolean;
};

/** Creates the caller's business and turns seller mode on. Returns the new business id. */
export async function createMyBusiness(input: CreateBusinessInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_my_business', {
    p_type: input.type,
    p_name: input.name,
    p_cuisine_code: input.cuisine_code,
    p_accepts_table_requests: input.type === 'restaurant' && input.accepts_table_requests,
  });
  if (error) throw mapSellerError(error);
  return data;
}

export type BusinessPatch = Partial<EditFormValues>;

/** Sends only name, cuisine_code and accepts_table_requests; never type, is_listed or coordinates. */
export async function updateMyBusiness(id: string, patch: BusinessPatch): Promise<MyBusiness> {
  const allowed: BusinessPatch = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.cuisine_code !== undefined && { cuisine_code: patch.cuisine_code }),
    ...(patch.accepts_table_requests !== undefined && {
      accepts_table_requests: patch.accepts_table_requests,
    }),
  };

  const { data, error } = await supabase
    .from('businesses')
    .update(allowed)
    .eq('id', id)
    .select('id');
  if (error) throw mapSellerError(error);
  if (!data || data.length === 0) throw new SellerAppError('no_business');

  const business = await getMyBusiness();
  if (!business) throw new SellerAppError('no_business');
  return business;
}

/** Seller mode on or off: shows or hides the listing and the Manage tab. Nothing is deleted. */
export async function setSellerMode(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_seller_mode', { p_on: on });
  if (error) throw mapSellerError(error);
}

/** Address suggestions through the places-autocomplete Edge Function (the Places key never leaves it). */
export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const { data, error } = await supabase.functions.invoke<unknown>('places-autocomplete', {
    body: { input, sessionToken },
    signal,
  });
  if (error) throw await mapFunctionError(error);
  const parsed = placeSuggestionsResponseSchema.safeParse(data);
  if (!parsed.success) throw new SellerAppError('unknown');
  return parsed.data.suggestions;
}

/**
 * Saves the picked place as the caller's address. The server resolves the coordinates and works
 * out the public map point; the app sends only the place ID and session token.
 */
export async function resolvePlace(placeId: string, sessionToken: string): Promise<MyBusiness> {
  const { data, error } = await supabase.functions.invoke<unknown>('places-resolve', {
    body: { placeId, sessionToken },
  });
  if (error) throw await mapFunctionError(error);
  return parseBusiness(data);
}
