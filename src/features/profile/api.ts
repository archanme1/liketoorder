import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Profile = Database['public']['Tables']['profiles']['Row'];

/** The only columns a client may write; the DB column grant enforces the same list. */
export type ProfilePatch = Partial<Pick<Profile, 'username' | 'display_name' | 'bio' | 'city'>>;
export type ProfileField = keyof ProfilePatch;

const PROFILE_COLUMNS = 'id, username, display_name, bio, city, is_seller, created_at, updated_at';

export type ProfileErrorCode =
  'username_taken' | 'invalid_field' | 'not_signed_in' | 'not_found' | 'network' | 'unknown';

export class ProfileAppError extends Error {
  readonly code: ProfileErrorCode;
  /** Set for invalid_field: which column's check constraint failed. */
  readonly field?: ProfileField;

  constructor(code: ProfileErrorCode, field?: ProfileField) {
    super(code);
    this.name = 'ProfileAppError';
    this.code = code;
    this.field = field;
  }
}

const CHECK_CONSTRAINT_FIELDS: Record<string, ProfileField> = {
  profiles_username_check: 'username',
  profiles_username_not_reserved: 'username',
  profiles_display_name_check: 'display_name',
  profiles_bio_check: 'bio',
  profiles_city_check: 'city',
};

export function mapProfileError(error: unknown): ProfileAppError {
  if (error instanceof ProfileAppError) return error;
  if (!error || typeof error !== 'object') return new ProfileAppError('unknown');
  const { code = '', message = '', details = '' } = error as Partial<PostgrestError>;
  const text = `${message} ${details ?? ''}`;

  if (code === '23505' && text.includes('username')) return new ProfileAppError('username_taken');
  if (code === '23514') {
    const constraint = Object.keys(CHECK_CONSTRAINT_FIELDS).find((name) => text.includes(name));
    return new ProfileAppError(
      'invalid_field',
      constraint ? CHECK_CONSTRAINT_FIELDS[constraint] : undefined,
    );
  }
  if (!code && /network|fetch/i.test(text)) return new ProfileAppError('network');
  return new ProfileAppError('unknown');
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ProfileAppError('not_signed_in');
  return id;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapProfileError(error);
  return data;
}

export async function getMyProfile(): Promise<Profile | null> {
  return getProfile(await currentUserId());
}

/** Sends only username, display_name, bio and city — never id, is_seller or timestamps. */
export async function updateMyProfile(patch: ProfilePatch): Promise<Profile> {
  const id = await currentUserId();
  const allowed: ProfilePatch = {
    ...(patch.username !== undefined && { username: patch.username }),
    ...(patch.display_name !== undefined && { display_name: patch.display_name }),
    ...(patch.bio !== undefined && { bio: patch.bio }),
    ...(patch.city !== undefined && { city: patch.city }),
  };

  const { data, error } = await supabase
    .from('profiles')
    .update(allowed)
    .eq('id', id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw mapProfileError(error);
  if (!data) throw new ProfileAppError('not_found');
  return data;
}
