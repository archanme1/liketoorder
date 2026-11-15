import type { Cuisine } from '@/features/cuisines/schema';

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
