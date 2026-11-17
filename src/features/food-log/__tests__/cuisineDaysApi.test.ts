import { supabase } from '@/lib/supabase';

import { cuisineDaysJson } from '../__fixtures__/foodLog';
import { FoodLogAppError, getMyFoodLogCuisineDays } from '../api';

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

const DAY = { date: '2026-11-12', count: 2, cuisines: 1, cuisine: 'IT' };

describe('getMyFoodLogCuisineDays (spec 15)', () => {
  it('sends only the zone name and the week count, never a date', async () => {
    rpc.mockResolvedValue({ data: cuisineDaysJson(), error: null });
    await expect(getMyFoodLogCuisineDays('Asia/Tokyo', 17)).resolves.toEqual(cuisineDaysJson());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_my_food_log_cuisine_days', {
      p_time_zone: 'Asia/Tokyo',
      p_weeks: 17,
    });
  });

  it('accepts no days (a caller with no uploads)', async () => {
    rpc.mockResolvedValue({ data: cuisineDaysJson({ days: [] }), error: null });
    await expect(getMyFoodLogCuisineDays('UTC', 53)).resolves.toEqual(
      cuisineDaysJson({ days: [] }),
    );
  });

  it.each([
    ['an extra top-level key', { ...cuisineDaysJson(), stats: {} }],
    ['a missing top-level key', { today: '2026-11-12', days: [] }],
    ['an extra key on a day', { ...cuisineDaysJson(), days: [{ ...DAY, name: 'Italy' }] }],
    [
      'a missing key on a day',
      { ...cuisineDaysJson(), days: [{ date: DAY.date, count: 2, cuisines: 1 }] },
    ],
    ['cuisine set with cuisines above 1', cuisineDaysJson({ days: [{ ...DAY, cuisines: 2 }] })],
    ['cuisine null with cuisines 1', cuisineDaysJson({ days: [{ ...DAY, cuisine: null }] })],
    ['cuisines 0', cuisineDaysJson({ days: [{ ...DAY, cuisines: 0, cuisine: null }] })],
    ['count 0', cuisineDaysJson({ days: [{ ...DAY, count: 0 }] })],
    ['a date that is not YYYY-MM-DD', { ...cuisineDaysJson(), today: '12/11/2026' }],
  ])('refuses a reply with %s (unknown)', async (_name, data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await codeOf(getMyFoodLogCuisineDays('UTC', 17))).toBe('unknown');
  });

  it('maps the server codes', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'invalid_time_zone' },
    });
    expect(await codeOf(getMyFoodLogCuisineDays('Mars/Olympus', 17))).toBe('invalid_time_zone');
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'invalid_input' } });
    expect(await codeOf(getMyFoodLogCuisineDays('UTC', 54))).toBe('invalid_input');
  });
});
