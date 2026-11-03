import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import { cuisineRowsSchema, type Cuisine } from './schema';

const CUISINE_COLUMNS = 'code, kind, name, flag, icon, sort_order';

export type CuisineErrorCode = 'network' | 'invalid_data' | 'unknown';

export class CuisineAppError extends Error {
  readonly code: CuisineErrorCode;

  constructor(code: CuisineErrorCode) {
    super(code);
    this.name = 'CuisineAppError';
    this.code = code;
  }
}

export function mapCuisineError(error: unknown): CuisineAppError {
  if (error instanceof CuisineAppError) return error;
  if (!error || typeof error !== 'object') return new CuisineAppError('unknown');
  const { code = '', message = '', details = '' } = error as Partial<PostgrestError>;
  const text = `${message} ${details ?? ''}`;

  if (!code && /network|fetch/i.test(text)) return new CuisineAppError('network');
  return new CuisineAppError('unknown');
}

/** Read-only catalog; works without a session (anon key). Countries A–Z, then Street food, Fusion, Other. */
export async function listCuisines(): Promise<Cuisine[]> {
  const { data, error } = await supabase
    .from('cuisines')
    .select(CUISINE_COLUMNS)
    .order('sort_order')
    .order('name');
  if (error) throw mapCuisineError(error);

  // kind, flag and icon are only typed string | null by the generated types, so parse.
  const parsed = cuisineRowsSchema.safeParse(data);
  if (!parsed.success) throw new CuisineAppError('invalid_data');
  return parsed.data;
}
