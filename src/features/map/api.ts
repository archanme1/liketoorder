import {
  FunctionsFetchError,
  FunctionsRelayError,
  type PostgrestError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import type { MapBox } from './region';
import { pinsResponseSchema, type PinsResponse } from './schema';

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
