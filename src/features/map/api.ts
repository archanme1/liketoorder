import {
  FunctionsFetchError,
  FunctionsRelayError,
  type PostgrestError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import type { MapBox } from './region';
import {
  pinsResponseSchema,
  homemadeDetailsSchema,
  restaurantDetailsSchema,
  type HomemadeDetails,
  type PinsResponse,
  type RestaurantDetails,
} from './schema';

export type MapErrorCode = 'invalid_bounds' | 'rate_limited' | 'network' | 'unknown';

// Carries only a code, never the box, a place or the upstream message.
export class MapAppError extends Error {
  readonly code: MapErrorCode;

  constructor(code: MapErrorCode) {
    super(code);
    this.name = 'MapAppError';
    this.code = code;
  }
}

const KNOWN_CODES: Record<string, MapErrorCode> = {
  invalid_bounds: 'invalid_bounds',
  rate_limited: 'rate_limited',
};

/** Maps an RPC error from the public map functions. */
export function mapMapError(error: unknown): MapAppError {
  if (error instanceof MapAppError) return error;
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new MapAppError('network');
  }
  if (!error || typeof error !== 'object') return new MapAppError('unknown');
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  if (code === 'P0001' && message in KNOWN_CODES) return new MapAppError(KNOWN_CODES[message]);
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new MapAppError('network');
  }
  return new MapAppError('unknown');
}

/**
 * The restaurants in the visible area. Sends only the map box (four numbers): never the person's
 * position, never anything else.
 */
export async function fetchPinsInBounds(box: MapBox): Promise<PinsResponse> {
  const { data, error } = await supabase.rpc('map_restaurants_in_bounds', {
    p_min_lat: box.minLat,
    p_max_lat: box.maxLat,
    p_min_lng: box.minLng,
    p_max_lng: box.maxLng,
  });
  if (error) throw mapMapError(error);
  const parsed = pinsResponseSchema.safeParse(data);
  if (!parsed.success) throw new MapAppError('unknown');
  return parsed.data;
}

/**
 * One restaurant's public details, or `null` when it is not available (hidden, unlisted,
 * homemade, stale or no such id: the server answers the same for all of them). Sends only the id.
 */
export async function fetchRestaurantDetails(id: string): Promise<RestaurantDetails | null> {
  const { data, error } = await supabase.rpc('get_restaurant_details', { p_business_id: id });
  if (error) throw mapMapError(error);
  if (data === null) return null;
  const parsed = restaurantDetailsSchema.safeParse(data);
  if (!parsed.success) throw new MapAppError('unknown');
  return parsed.data;
}

/**
 * The homemade cooks in the visible area. Sends only the map box. The points that come back are
 * the server's shifted public points; nothing exact is ever returned.
 */
export async function fetchHomemadeInBounds(box: MapBox): Promise<PinsResponse> {
  const { data, error } = await supabase.rpc('map_homemade_in_bounds', {
    p_min_lat: box.minLat,
    p_max_lat: box.maxLat,
    p_min_lng: box.minLng,
    p_max_lng: box.maxLng,
  });
  if (error) throw mapMapError(error);
  const parsed = pinsResponseSchema.safeParse(data);
  if (!parsed.success) throw new MapAppError('unknown');
  return parsed.data;
}

/**
 * One cook's public details, or `null` when not available (hidden, unlisted, stale, a restaurant
 * or no such id: the server answers the same for all of them). Sends only the id.
 */
export async function fetchHomemadeDetails(id: string): Promise<HomemadeDetails | null> {
  const { data, error } = await supabase.rpc('get_homemade_details', { p_business_id: id });
  if (error) throw mapMapError(error);
  if (data === null) return null;
  const parsed = homemadeDetailsSchema.safeParse(data);
  if (!parsed.success) throw new MapAppError('unknown');
  return parsed.data;
}
