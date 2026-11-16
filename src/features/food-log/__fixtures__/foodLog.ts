import type { Cuisine } from '@/features/cuisines/schema';
import { addDays, dayOfWeek } from '@/lib/localDate';

import type { FoodLog } from '../schema';

// Built from code points so the source stays ASCII.
export const CUISINES: Cuisine[] = [
  {
    code: 'IT',
    kind: 'country',
    name: 'Italy',
    flag: String.fromCodePoint(0x1f1ee, 0x1f1f9),
    icon: null,
    sort_order: 100,
  },
  {
    code: 'JP',
    kind: 'country',
    name: 'Japan',
    flag: String.fromCodePoint(0x1f1ef, 0x1f1f5),
    icon: null,
    sort_order: 110,
  },
];

export function foodLog(n: number, overrides: Partial<FoodLog> = {}): FoodLog & { path: string } {
  const id = `00000000-0000-0000-0000-${String(1300 + n).padStart(12, '0')}`;
  return {
    id,
    cuisine_code: 'IT',
    description: `Meal ${n}`,
    is_public: true,
    local_date: '2026-11-14',
    created_at: '2026-11-14T12:00:00+00:00',
    path: `u1/${id}.jpg`,
    is_mine: true,
    ...overrides,
  } as FoodLog & { path: string };
}

/** The server's range start: the Sunday (weeks - 1) weeks before today's week (the migration). */
export function activityFrom(today: string, weeks: number): string {
  return addDays(today, -dayOfWeek(today) - 7 * (weeks - 1));
}

type ActivityJson = {
  today: string;
  from: string;
  days: { date: string; count: number }[];
  stats: {
    total_this_year: number;
    current_streak: number;
    longest_streak: number;
    cuisines_tried: number;
  };
};

/**
 * get_my_food_log_activity's JSON, with exactly the migration's keys. Today is Thu 2026-11-12 by
 * default; `from` follows today and `weeks` unless given.
 */
export function activityJson(overrides: Partial<ActivityJson> = {}, weeks = 17): ActivityJson {
  const today = overrides.today ?? '2026-11-12';
  return {
    today,
    from: activityFrom(today, weeks),
    days: [
      { date: '2026-11-03', count: 1 },
      { date: '2026-11-10', count: 2 },
      { date: '2026-11-11', count: 4 },
      { date: '2026-11-12', count: 3 },
    ],
    stats: { total_this_year: 40, current_streak: 3, longest_streak: 9, cuisines_tried: 6 },
    ...overrides,
  };
}

export const ZERO_STATS = {
  total_this_year: 0,
  current_streak: 0,
  longest_streak: 0,
  cuisines_tried: 0,
};

/** list_my_food_logs_on's JSON: { items } with spec 13's 8-key log objects. */
export function dayJson(items: FoodLog[] = []): { items: FoodLog[] } {
  return { items };
}

export function testClientOptions() {
  return {
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  } as const;
}

/**
 * Resets every jest.fn in the given mocked modules (calls and implementations), so one test's
 * mockResolvedValue never reaches the next. Unlike jest.resetAllMocks it leaves the jest.setup.ts
 * fakes (getCalendars, getLocales, the picker) alone. Paths resolve as they do from __tests__.
 */
export function resetModuleMocks(...paths: string[]) {
  for (const path of paths) {
    for (const value of Object.values(jest.requireMock<Record<string, unknown>>(path))) {
      if (jest.isMockFunction(value)) value.mockReset();
    }
  }
}
