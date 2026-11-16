import type { PostgrestError } from '@supabase/supabase-js';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

import {
  foodLogActivitySchema,
  foodLogDaySchema,
  foodLogPageSchema,
  foodLogReservationSchema,
  foodLogSchema,
  type FoodLog,
  type FoodLogActivity,
  type FoodLogDay,
  type FoodLogPage,
  type FoodLogReservation,
} from './schema';

export type FoodLogErrorCode =
  | 'profile_incomplete'
  | 'invalid_input'
  | 'invalid_text'
  | 'contact_info'
  | 'invalid_time_zone'
  | 'too_many_pending'
  | 'daily_limit'
  | 'cleanup_required'
  | 'not_found'
  | 'upload_missing'
  | 'network'
  | 'unknown';

// Carries only a code, never a description, path or the upstream message.
export class FoodLogAppError extends Error {
  readonly code: FoodLogErrorCode;

  constructor(code: FoodLogErrorCode) {
    super(code);
    this.name = 'FoodLogAppError';
    this.code = code;
  }
}

// Codes raised by the food log functions (raise exception '<code>').
const KNOWN_CODES: Record<string, FoodLogErrorCode> = {
  profile_incomplete: 'profile_incomplete',
  invalid_input: 'invalid_input',
  invalid_text: 'invalid_text',
  contact_info: 'contact_info',
  invalid_time_zone: 'invalid_time_zone',
  too_many_pending: 'too_many_pending',
  daily_limit: 'daily_limit',
  cleanup_required: 'cleanup_required',
  not_found: 'not_found',
  upload_missing: 'upload_missing',
};

/** Maps a PostgREST / RPC error. A bad uuid (22P02) is not_found: no such log. */
export function mapFoodLogError(error: unknown): FoodLogAppError {
  if (error instanceof FoodLogAppError) return error;
  if (!error || typeof error !== 'object') return new FoodLogAppError('unknown');
  // details can be null at runtime, and a destructuring default only covers undefined.
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  // Own keys only: "constructor" or "toString" must not count as codes.
  if (code === 'P0001' && Object.hasOwn(KNOWN_CODES, message)) {
    return new FoodLogAppError(KNOWN_CODES[message]);
  }
  if (code === '22P02') return new FoodLogAppError('not_found');
  if (code === '23514' || code === '23503') return new FoodLogAppError('invalid_input');
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new FoodLogAppError('network');
  }
  return new FoodLogAppError('unknown');
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new FoodLogAppError('unknown');
  return parsed.data;
}

// The generated RPC types mark every argument non-null, but p_description takes null ("no
// description"). This keeps the null without an `any`.
function nullable<T>(value: T | null): T {
  return value as T;
}

export type FoodLogFields = {
  cuisineCode: string;
  /** Normalized and trimmed; null for no description. */
  description: string | null;
  isPublic: boolean;
};

/** Reserves an upload; the server makes the path and sets the time and the local date. */
export async function beginFoodLogUpload(
  fields: FoodLogFields,
  timeZone: string,
): Promise<FoodLogReservation> {
  const { data, error } = await supabase.rpc('begin_food_log_upload', {
    p_cuisine_code: fields.cuisineCode,
    p_description: nullable(fields.description),
    p_is_public: fields.isPublic,
    p_time_zone: timeZone,
  });
  if (error) throw mapFoodLogError(error);
  return parse(foodLogReservationSchema, data);
}

/** Marks the reservation ready once its file is in Storage. */
export async function finishFoodLogUpload(id: string): Promise<FoodLog> {
  const { data, error } = await supabase.rpc('finish_food_log_upload', { p_id: id });
  if (error) throw mapFoodLogError(error);
  return parse(foodLogSchema, data);
}

/** Changes the cuisine, description and visibility. The photo, date and time never change. */
export async function updateFoodLog(id: string, fields: FoodLogFields): Promise<FoodLog> {
  const { data, error } = await supabase.rpc('update_food_log', {
    p_id: id,
    p_cuisine_code: fields.cuisineCode,
    p_description: nullable(fields.description),
    p_is_public: fields.isPublic,
  });
  if (error) throw mapFoodLogError(error);
  return parse(foodLogSchema, data);
}

/** Deletes a log (pending or ready); its file is queued for cleanup. */
export async function deleteFoodLog(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_food_log', { p_id: id });
  if (error) throw mapFoodLogError(error);
}

export async function getFoodLog(id: string): Promise<FoodLog> {
  const { data, error } = await supabase.rpc('get_food_log', { p_id: id });
  if (error) throw mapFoodLogError(error);
  return parse(foodLogSchema, data);
}

/** The caller's ready logs, newest first, 50 a page. */
export async function listMyFoodLogs(before: string | null): Promise<FoodLogPage> {
  const { data, error } = await supabase.rpc(
    'list_my_food_logs',
    before === null ? {} : { p_before: before },
  );
  if (error) throw mapFoodLogError(error);
  return parse(foodLogPageSchema, data);
}

/**
 * My activity for the last `weeks` weeks (spec 14). Only the zone name is sent: the server works
 * out today, the range and every count and streak.
 */
export async function getMyFoodLogActivity(
  timeZone: string,
  weeks: number,
): Promise<FoodLogActivity> {
  const { data, error } = await supabase.rpc('get_my_food_log_activity', {
    p_time_zone: timeZone,
    p_weeks: weeks,
  });
  if (error) throw mapFoodLogError(error);
  return parse(foodLogActivitySchema, data);
}

/** My ready logs on one local date, oldest first (at most 60). */
export async function listMyFoodLogsOn(date: string): Promise<FoodLogDay> {
  const { data, error } = await supabase.rpc('list_my_food_logs_on', { p_date: date });
  if (error) throw mapFoodLogError(error);
  return parse(foodLogDaySchema, data);
}

/** Drops queue rows whose file is gone and returns the queued paths whose file still exists. */
export async function claimFoodLogCleanup(): Promise<string[]> {
  const { data, error } = await supabase.rpc('claim_food_log_cleanup');
  if (error) throw mapFoodLogError(error);
  return parse(z.array(z.string()), data ?? []);
}
