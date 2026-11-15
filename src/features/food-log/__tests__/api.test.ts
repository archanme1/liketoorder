import { supabase } from '@/lib/supabase';

import {
  FoodLogAppError,
  beginFoodLogUpload,
  claimFoodLogCleanup,
  deleteFoodLog,
  finishFoodLogUpload,
  getFoodLog,
  listMyFoodLogs,
  mapFoodLogError,
  updateFoodLog,
  type FoodLogErrorCode,
} from '../api';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const mocked = supabase as unknown as { rpc: jest.Mock };

const LOG = {
  id: '00000000-0000-0000-0000-000000001301',
  cuisine_code: 'IT',
  description: 'Pasta',
  is_public: true,
  local_date: '2026-11-14',
  created_at: '2026-11-14T12:00:00.123456+00:00',
  path: 'u1/00000000-0000-0000-0000-000000001301.jpg',
  is_mine: true,
};
const FIELDS = { cuisineCode: 'IT', description: 'Pasta', isPublic: false };

function resolves(data: unknown) {
  mocked.rpc.mockResolvedValueOnce({ data, error: null });
}

function fails(error: unknown) {
  mocked.rpc.mockResolvedValueOnce({ data: null, error });
}

async function codeOf(promise: Promise<unknown>): Promise<FoodLogErrorCode | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (error instanceof FoodLogAppError) return error.code;
    throw error;
  }
}

beforeEach(() => mocked.rpc.mockReset());

describe('the RPC calls', () => {
  it('begin sends exactly the cuisine, description, visibility and zone (no date or time)', async () => {
    resolves({ id: LOG.id, path: LOG.path });
    await expect(beginFoodLogUpload(FIELDS, 'Pacific/Kiritimati')).resolves.toEqual({
      id: LOG.id,
      path: LOG.path,
    });
    expect(mocked.rpc).toHaveBeenCalledWith('begin_food_log_upload', {
      p_cuisine_code: 'IT',
      p_description: 'Pasta',
      p_is_public: false,
      p_time_zone: 'Pacific/Kiritimati',
    });
  });

  it('begin and update send a missing description as null', async () => {
    resolves({ id: LOG.id, path: LOG.path });
    await beginFoodLogUpload({ ...FIELDS, description: null }, 'UTC');
    expect(mocked.rpc.mock.calls[0][1].p_description).toBeNull();

    resolves({ ...LOG, description: null });
    await updateFoodLog(LOG.id, { ...FIELDS, description: null });
    expect(mocked.rpc).toHaveBeenLastCalledWith('update_food_log', {
      p_id: LOG.id,
      p_cuisine_code: 'IT',
      p_description: null,
      p_is_public: false,
    });
  });

  it('finish, get and delete send the id', async () => {
    resolves(LOG);
    await expect(finishFoodLogUpload(LOG.id)).resolves.toEqual(LOG);
    expect(mocked.rpc).toHaveBeenLastCalledWith('finish_food_log_upload', { p_id: LOG.id });

    resolves(LOG);
    await expect(getFoodLog(LOG.id)).resolves.toEqual(LOG);
    expect(mocked.rpc).toHaveBeenLastCalledWith('get_food_log', { p_id: LOG.id });

    resolves(null);
    await expect(deleteFoodLog(LOG.id)).resolves.toBeUndefined();
    expect(mocked.rpc).toHaveBeenLastCalledWith('delete_food_log', { p_id: LOG.id });
  });

  it('list sends no cursor for the first page and the server cursor untouched after', async () => {
    resolves({ items: [LOG], next_cursor: '2026-11-14T12:00:00.123456Z|' + LOG.id });
    await expect(listMyFoodLogs(null)).resolves.toEqual({
      items: [LOG],
      next_cursor: '2026-11-14T12:00:00.123456Z|' + LOG.id,
    });
    expect(mocked.rpc).toHaveBeenLastCalledWith('list_my_food_logs', {});

    resolves({ items: [], next_cursor: null });
    await listMyFoodLogs('2026-11-14T12:00:00.123456Z|' + LOG.id);
    expect(mocked.rpc).toHaveBeenLastCalledWith('list_my_food_logs', {
      p_before: '2026-11-14T12:00:00.123456Z|' + LOG.id,
    });
  });

  it('claim returns the queued paths (and an empty list for null)', async () => {
    resolves(['u1/a.jpg']);
    await expect(claimFoodLogCleanup()).resolves.toEqual(['u1/a.jpg']);
    expect(mocked.rpc).toHaveBeenLastCalledWith('claim_food_log_cleanup');
    resolves(null);
    await expect(claimFoodLogCleanup()).resolves.toEqual([]);
  });

  it('refuses a log object with an extra or a missing key', async () => {
    resolves({ ...LOG, author_id: 'u1' });
    expect(await codeOf(getFoodLog(LOG.id))).toBe('unknown');
    const { is_mine: _dropped, ...missing } = LOG;
    resolves(missing);
    expect(await codeOf(getFoodLog(LOG.id))).toBe('unknown');
  });
});

describe('error mapping', () => {
  it.each([
    'profile_incomplete',
    'invalid_input',
    'invalid_text',
    'contact_info',
    'invalid_time_zone',
    'too_many_pending',
    'daily_limit',
    'cleanup_required',
    'not_found',
    'upload_missing',
  ] as const)('maps the server code %s', async (code) => {
    fails({ code: 'P0001', message: code, details: null });
    expect(await codeOf(beginFoodLogUpload(FIELDS, 'UTC'))).toBe(code);
  });

  it('maps a malformed id to not_found and a check failure to invalid_input', () => {
    expect(
      mapFoodLogError({ code: '22P02', message: 'invalid input syntax for type uuid' }).code,
    ).toBe('not_found');
    expect(mapFoodLogError({ code: '23514', message: 'check' }).code).toBe('invalid_input');
  });

  it('maps a fetch failure to network and anything else to unknown', () => {
    expect(mapFoodLogError({ message: 'TypeError: Network request failed' }).code).toBe('network');
    expect(mapFoodLogError({ code: 'P0001', message: 'something_new' }).code).toBe('unknown');
    expect(mapFoodLogError(null).code).toBe('unknown');
  });

  it('never carries the upstream message', () => {
    const error = mapFoodLogError({ code: 'XX000', message: 'secret detail u1/abc.jpg' });
    expect(error.message).toBe('unknown');
  });
});
