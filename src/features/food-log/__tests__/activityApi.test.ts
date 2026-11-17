import { supabase } from '@/lib/supabase';

import { activityJson, dayJson, foodLog } from '../__fixtures__/foodLog';
import { FoodLogAppError, getMyFoodLogActivity, listMyFoodLogsOn } from '../api';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;

afterEach(() => {
  rpc.mockReset();
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FoodLogAppError) return error.code;
    throw error;
  }
  throw new Error('expected a FoodLogAppError');
}

describe('getMyFoodLogActivity', () => {
  it('sends only the zone name and the week count, never a date', async () => {
    rpc.mockResolvedValue({ data: activityJson(), error: null });
    await expect(getMyFoodLogActivity('Asia/Tokyo', 17)).resolves.toEqual(activityJson());
    expect(rpc).toHaveBeenCalledWith('get_my_food_log_activity', {
      p_time_zone: 'Asia/Tokyo',
      p_weeks: 17,
    });
  });

  it('refuses a reply with an extra or a missing key (strict, like the pinned key sets)', async () => {
    rpc.mockResolvedValueOnce({ data: { ...activityJson(), extra: 1 }, error: null });
    expect(await codeOf(getMyFoodLogActivity('UTC', 17))).toBe('unknown');

    const { stats, ...noStats } = activityJson();
    rpc.mockResolvedValueOnce({ data: noStats, error: null });
    expect(stats.current_streak).toBe(3);
    expect(await codeOf(getMyFoodLogActivity('UTC', 17))).toBe('unknown');

    const bad = activityJson();
    rpc.mockResolvedValueOnce({
      data: { ...bad, stats: { ...bad.stats, most_frequent: 'IT' } },
      error: null,
    });
    expect(await codeOf(getMyFoodLogActivity('UTC', 17))).toBe('unknown');

    rpc.mockResolvedValueOnce({
      data: { ...bad, days: [{ date: '2026-11-12', count: 1, cuisine: 'IT' }] },
      error: null,
    });
    expect(await codeOf(getMyFoodLogActivity('UTC', 17))).toBe('unknown');
  });

  it('maps the server codes', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'invalid_time_zone' },
    });
    expect(await codeOf(getMyFoodLogActivity('Mars/Olympus', 17))).toBe('invalid_time_zone');
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'invalid_input' } });
    expect(await codeOf(getMyFoodLogActivity('UTC', 54))).toBe('invalid_input');
  });
});

describe('listMyFoodLogsOn', () => {
  it('sends the date and parses 8-key log objects', async () => {
    const items = [foodLog(1, { local_date: '2026-11-12' })];
    rpc.mockResolvedValue({ data: dayJson(items), error: null });
    await expect(listMyFoodLogsOn('2026-11-12')).resolves.toEqual({ items });
    expect(rpc).toHaveBeenCalledWith('list_my_food_logs_on', { p_date: '2026-11-12' });
  });

  it('refuses a log object with a ninth key', async () => {
    const withNinthKey = { ...foodLog(1), status: 'ready' };
    rpc.mockResolvedValue({ data: { items: [withNinthKey] }, error: null });
    expect(await codeOf(listMyFoodLogsOn('2026-11-12'))).toBe('unknown');
  });
});
