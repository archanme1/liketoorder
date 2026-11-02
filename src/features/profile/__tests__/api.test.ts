import { supabase } from '@/lib/supabase';

import {
  ProfileAppError,
  getMyProfile,
  getProfile,
  mapProfileError,
  updateMyProfile,
} from '../api';

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

const mockedAuth = supabase.auth as unknown as { getSession: jest.Mock };
const mockedFrom = supabase.from as unknown as jest.Mock;

const profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

type Result = { data: unknown; error: unknown };

function builder(result: Result) {
  const b = {
    select: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
  };
  b.select.mockReturnValue(b);
  b.update.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.maybeSingle.mockResolvedValue(result);
  return b;
}

function pgError(code: string | undefined, message: string, details = '') {
  return { code, message, details, hint: '' };
}

async function caught(promise: Promise<unknown>): Promise<ProfileAppError> {
  try {
    await promise;
  } catch (e) {
    return e as ProfileAppError;
  }
  throw new Error('expected rejection');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

describe('mapProfileError', () => {
  it('maps a username unique violation to username_taken', () => {
    const e = mapProfileError(
      pgError('23505', 'duplicate key value violates unique constraint "profiles_username_key"'),
    );
    expect(e).toBeInstanceOf(ProfileAppError);
    expect(e.code).toBe('username_taken');
  });

  it('detects username in details too', () => {
    const e = mapProfileError(pgError('23505', 'duplicate key', 'Key (username)=(archan) exists.'));
    expect(e.code).toBe('username_taken');
  });

  it.each([
    ['profiles_username_check', 'username'],
    ['profiles_username_not_reserved', 'username'],
    ['profiles_display_name_check', 'display_name'],
    ['profiles_bio_check', 'bio'],
    ['profiles_city_check', 'city'],
  ])('maps check violation %s to invalid_field on %s', (constraint, field) => {
    const e = mapProfileError(
      pgError('23514', `new row violates check constraint "${constraint}"`),
    );
    expect(e.code).toBe('invalid_field');
    expect(e.field).toBe(field);
  });

  it('maps a network failure', () => {
    expect(mapProfileError({ message: 'Network request failed' }).code).toBe('network');
    expect(mapProfileError({ message: 'TypeError: Failed to fetch' }).code).toBe('network');
  });

  it('maps anything else to unknown', () => {
    expect(mapProfileError(pgError('XX000', 'boom')).code).toBe('unknown');
    expect(mapProfileError(new Error('weird')).code).toBe('unknown');
    expect(mapProfileError(null).code).toBe('unknown');
  });
});

describe('getProfile', () => {
  it('queries profiles by id and returns the row', async () => {
    const b = builder({ data: profile, error: null });
    mockedFrom.mockReturnValue(b);
    await expect(getProfile('u2')).resolves.toEqual(profile);
    expect(mockedFrom).toHaveBeenCalledWith('profiles');
    expect(b.eq).toHaveBeenCalledWith('id', 'u2');
  });

  it('returns null / not_found when the row is missing', async () => {
    mockedFrom.mockReturnValue(builder({ data: null, error: null }));
    let outcome: unknown;
    try {
      outcome = await getProfile('nope');
    } catch (e) {
      outcome = e;
    }
    if (outcome instanceof ProfileAppError) expect(outcome.code).toBe('not_found');
    else expect(outcome).toBeNull();
  });

  it('maps errors', async () => {
    mockedFrom.mockReturnValue(builder({ data: null, error: pgError('XX000', 'boom') }));
    const e = await caught(getProfile('u2'));
    expect(e).toBeInstanceOf(ProfileAppError);
    expect(e.code).toBe('unknown');
  });
});

describe('getMyProfile', () => {
  it('uses the session user id', async () => {
    const b = builder({ data: profile, error: null });
    mockedFrom.mockReturnValue(b);
    await expect(getMyProfile()).resolves.toEqual(profile);
    expect(b.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('throws not_signed_in without a session and does not query', async () => {
    mockedAuth.getSession.mockResolvedValue({ data: { session: null } });
    const e = await caught(getMyProfile());
    expect(e.code).toBe('not_signed_in');
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('maps network errors', async () => {
    mockedFrom.mockReturnValue(
      builder({ data: null, error: { message: 'Network request failed' } }),
    );
    expect((await caught(getMyProfile())).code).toBe('network');
  });
});

describe('updateMyProfile', () => {
  it('updates the signed-in user and resolves the updated profile', async () => {
    const updated = { ...profile, bio: 'hello' };
    const b = builder({ data: updated, error: null });
    mockedFrom.mockReturnValue(b);
    await expect(updateMyProfile({ bio: 'hello' })).resolves.toEqual(updated);
    expect(mockedFrom).toHaveBeenCalledWith('profiles');
    expect(b.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('sends only username, display_name, bio and city', async () => {
    const b = builder({ data: profile, error: null });
    mockedFrom.mockReturnValue(b);
    const patch = {
      username: 'archan',
      display_name: 'Archan',
      bio: 'b',
      city: 'c',
      is_seller: true,
      id: 'other',
      created_at: 'x',
      updated_at: 'y',
    } as unknown as Parameters<typeof updateMyProfile>[0];
    await updateMyProfile(patch);
    expect(b.update).toHaveBeenCalledWith({
      username: 'archan',
      display_name: 'Archan',
      bio: 'b',
      city: 'c',
    });
  });

  it('omits undefined keys', async () => {
    const b = builder({ data: profile, error: null });
    mockedFrom.mockReturnValue(b);
    await updateMyProfile({ bio: 'only', city: undefined });
    expect(b.update).toHaveBeenCalledWith({ bio: 'only' });
  });

  it('throws not_signed_in without a session', async () => {
    mockedAuth.getSession.mockResolvedValue({ data: { session: null } });
    expect((await caught(updateMyProfile({ bio: 'x' }))).code).toBe('not_signed_in');
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('throws not_found when no row is returned', async () => {
    mockedFrom.mockReturnValue(builder({ data: null, error: null }));
    expect((await caught(updateMyProfile({ bio: 'x' }))).code).toBe('not_found');
  });

  it('maps username unique violation', async () => {
    mockedFrom.mockReturnValue(
      builder({
        data: null,
        error: pgError(
          '23505',
          'duplicate key value violates unique constraint "profiles_username_key"',
        ),
      }),
    );
    expect((await caught(updateMyProfile({ username: 'taken' }))).code).toBe('username_taken');
  });

  it('maps check violation with its field', async () => {
    mockedFrom.mockReturnValue(
      builder({
        data: null,
        error: pgError('23514', 'new row violates check constraint "profiles_bio_check"'),
      }),
    );
    const e = await caught(updateMyProfile({ bio: 'x' }));
    expect(e.code).toBe('invalid_field');
    expect(e.field).toBe('bio');
  });
});
