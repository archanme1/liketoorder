import type { PostgrestError } from '@supabase/supabase-js';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

import {
  businessPhotoSchema,
  currencySchema,
  menuItemSchema,
  photoReservationSchema,
  type BusinessPhoto,
  type Currency,
  type Menu,
  type PhotoKind,
  type PhotoReservation,
} from './schema';

export type MenuErrorCode =
  | 'no_business'
  | 'item_limit'
  | 'photo_limit'
  | 'currency_required'
  | 'prices_exist'
  | 'not_found'
  | 'upload_missing'
  | 'invalid_input'
  | 'cleanup_required'
  | 'network'
  | 'unknown';

// Carries only a code, never item text, paths or the upstream message.
export class MenuAppError extends Error {
  readonly code: MenuErrorCode;

  constructor(code: MenuErrorCode) {
    super(code);
    this.name = 'MenuAppError';
    this.code = code;
  }
}

// Codes raised by the menu functions (raise exception '<code>').
const KNOWN_CODES: Record<string, MenuErrorCode> = {
  no_business: 'no_business',
  item_limit: 'item_limit',
  photo_limit: 'photo_limit',
  currency_required: 'currency_required',
  prices_exist: 'prices_exist',
  not_found: 'not_found',
  upload_missing: 'upload_missing',
  invalid_input: 'invalid_input',
  invalid_direction: 'invalid_input',
  cleanup_required: 'cleanup_required',
};

/** Maps a PostgREST / RPC error. Constraint failures (23514 check, 23503 currency FK) are invalid input. */
export function mapMenuError(error: unknown): MenuAppError {
  if (error instanceof MenuAppError) return error;
  if (!error || typeof error !== 'object') return new MenuAppError('unknown');
  // details can be null at runtime, and a destructuring default only covers undefined.
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  if (code === 'P0001' && message in KNOWN_CODES) return new MenuAppError(KNOWN_CODES[message]);
  if (code === '23514' || code === '23503' || code === '22P02') {
    return new MenuAppError('invalid_input');
  }
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new MenuAppError('network');
  }
  return new MenuAppError('unknown');
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new MenuAppError('unknown');
  return parsed.data;
}

// The generated RPC types mark every argument non-null, but these SQL arguments take null
// ("no description", "no price"). This keeps the null without an `any`.
function nullable<T>(value: T | null): T {
  return value as T;
}

const ITEM_COLUMNS = 'id, business_id, name, description, price_minor, is_available, position';
const PHOTO_COLUMNS = 'id, business_id, kind, menu_item_id, path, position';

/** ISO 4217 currencies (active, 0/2/3 decimals), by name. */
export async function getCurrencies(): Promise<Currency[]> {
  const { data, error } = await supabase
    .from('currencies')
    .select('code, name, minor_units')
    .order('name');
  if (error) throw mapMenuError(error);
  return parse(z.array(currencySchema), data);
}

/**
 * A business's items (in order) and photos. Owner and guests use the same query; RLS decides what
 * comes back. The owner also sees unfinished uploads; gallery/menu ones have no position yet and
 * are left out here.
 */
export async function getMenu(businessId: string): Promise<Menu> {
  const [items, photos] = await Promise.all([
    supabase
      .from('menu_items')
      .select(ITEM_COLUMNS)
      .eq('business_id', businessId)
      .order('position'),
    supabase
      .from('business_photos')
      .select(PHOTO_COLUMNS)
      .eq('business_id', businessId)
      .order('position', { nullsFirst: false }),
  ]);
  if (items.error) throw mapMenuError(items.error);
  if (photos.error) throw mapMenuError(photos.error);
  const allPhotos = parse(z.array(businessPhotoSchema), photos.data);
  return {
    items: parse(z.array(menuItemSchema), items.data),
    photos: allPhotos.filter(
      (photo) => !((photo.kind === 'gallery' || photo.kind === 'menu') && photo.position === null),
    ),
  };
}

/** Sets the menu currency. Refused (prices_exist) once any item has a price. */
export async function setMenuCurrency(code: string): Promise<void> {
  const { error } = await supabase.rpc('set_menu_currency', { p_code: code });
  if (error) throw mapMenuError(error);
}

export type MenuItemInput = {
  name: string;
  description: string | null;
  price_minor: number | null;
  is_available: boolean;
};

/** Adds an item at the end of the list. Returns its id. */
export async function createMenuItem(input: MenuItemInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_menu_item', {
    p_name: input.name,
    p_description: nullable(input.description),
    p_price_minor: nullable(input.price_minor),
    p_is_available: input.is_available,
  });
  if (error) throw mapMenuError(error);
  return parse(z.string(), data);
}

/** Replaces an item's fields (all of them; position is unchanged). */
export async function updateMenuItem(itemId: string, input: MenuItemInput): Promise<void> {
  const { error } = await supabase.rpc('update_menu_item', {
    p_item_id: itemId,
    p_name: input.name,
    p_description: nullable(input.description),
    p_price_minor: nullable(input.price_minor),
    p_is_available: input.is_available,
  });
  if (error) throw mapMenuError(error);
}

export type MoveDirection = 'up' | 'down';

/** Swaps the item with its neighbour; nothing happens at either end. */
export async function moveMenuItem(itemId: string, direction: MoveDirection): Promise<void> {
  const { error } = await supabase.rpc('move_menu_item', {
    p_item_id: itemId,
    p_direction: direction,
  });
  if (error) throw mapMenuError(error);
}

/** Deletes the item; its photo row goes with it and the file is queued for cleanup. */
export async function deleteMenuItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_menu_item', { p_item_id: itemId });
  if (error) throw mapMenuError(error);
}

/** Reserves a photo slot; the server makes the path. */
export async function beginPhotoUpload(
  kind: PhotoKind,
  menuItemId?: string,
): Promise<PhotoReservation> {
  const { data, error } = await supabase.rpc('begin_photo_upload', {
    p_kind: kind,
    ...(menuItemId !== undefined && { p_menu_item_id: menuItemId }),
  });
  if (error) throw mapMenuError(error);
  return parse(photoReservationSchema, data);
}

/** Marks the reservation ready once its file is in Storage. Replaces a previous cover/item photo. */
export async function finishPhotoUpload(photoId: string): Promise<BusinessPhoto> {
  const { data, error } = await supabase.rpc('finish_photo_upload', { p_photo_id: photoId });
  if (error) throw mapMenuError(error);
  return parse(businessPhotoSchema, data);
}

/** Deletes a photo row (pending or ready); the file is queued for cleanup. */
export async function deleteBusinessPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_business_photo', { p_photo_id: photoId });
  if (error) throw mapMenuError(error);
}

/** Drops queue rows whose file is gone and returns the queued paths whose file still exists. */
export async function claimPhotoCleanup(): Promise<string[]> {
  const { data, error } = await supabase.rpc('claim_photo_cleanup');
  if (error) throw mapMenuError(error);
  return parse(z.array(z.string()), data ?? []);
}
