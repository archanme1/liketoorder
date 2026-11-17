import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { listCuisines } from '@/features/cuisines/api';

import {
  activityJson,
  CUISINES_WITH_NEUTRAL,
  cuisineDaysJson,
  foodLog,
  resetModuleMocks,
  testClientOptions,
} from '../__fixtures__/foodLog';
import {
  deleteFoodLog,
  getMyFoodLogActivity,
  getMyFoodLogCuisineDays,
  updateFoodLog,
} from '../api';
import { ActivitySection } from '../components/ActivitySection';
import { useCreateFoodLog, useDeleteFoodLog, useUpdateFoodLog } from '../hooks/useFoodLogMutations';
import { uploadFoodLog } from '../uploadFoodLog';

// Spec 15: creating, editing or deleting a log marks the cuisine days stale too, so a cuisine edit
// changes that day's glyph and label.

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  getMyFoodLogCuisineDays: jest.fn(),
  updateFoodLog: jest.fn(),
  deleteFoodLog: jest.fn(),
  claimFoodLogCleanup: jest.fn(async () => []),
}));
jest.mock('../uploadFoodLog', () => ({
  ...jest.requireActual('../uploadFoodLog'),
  uploadFoodLog: jest.fn(),
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));

const LOG = foodLog(1, { local_date: '2026-11-12', cuisine_code: 'IT' });
const CUISINE_DAYS = JSON.stringify(['food-log', 'cuisine-days']);

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient(testClientOptions());
  jest.mocked(listCuisines).mockResolvedValue(CUISINES_WITH_NEUTRAL);
  jest
    .mocked(getMyFoodLogActivity)
    .mockResolvedValue(activityJson({ days: [{ date: '2026-11-12', count: 1 }] }));
  // The server before and after the edit: today's one upload moves from Italy to Japan.
  const edited = () => jest.mocked(updateFoodLog).mock.calls.length > 0;
  jest.mocked(getMyFoodLogCuisineDays).mockImplementation(async () =>
    cuisineDaysJson({
      days: [{ date: '2026-11-12', count: 1, cuisines: 1, cuisine: edited() ? 'JP' : 'IT' }],
    }),
  );
  jest.mocked(updateFoodLog).mockResolvedValue({ ...LOG, cuisine_code: 'JP' });
  jest.mocked(deleteFoodLog).mockResolvedValue();
  jest.mocked(uploadFoodLog).mockResolvedValue(LOG);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api', '../uploadFoodLog', '@/features/cuisines/api');
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The query keys passed to invalidateQueries, as JSON for easy matching. */
function invalidatedKeys(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
}

describe('mutations mark the cuisine days stale', () => {
  it('create', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useCreateFoodLog(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({} as Parameters<typeof uploadFoodLog>[0]);
    });
    expect(invalidatedKeys(spy)).toContain(CUISINE_DAYS);
  });

  it('update', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useUpdateFoodLog(LOG.id), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ cuisineCode: 'JP', description: null, isPublic: true });
    });
    expect(invalidatedKeys(spy)).toContain(CUISINE_DAYS);
  });

  it('delete', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useDeleteFoodLog(LOG.id), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(invalidatedKeys(spy)).toContain(CUISINE_DAYS);
  });
});

describe('the Cuisine view after an edit', () => {
  it('stale glyph after a cuisine edit: the day shows the new cuisine', async () => {
    let update: ReturnType<typeof useUpdateFoodLog> | undefined;
    function Harness() {
      update = useUpdateFoodLog(LOG.id);
      return <ActivitySection weeks={17} initialView="cuisine" />;
    }
    await render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('button', { name: 'Nov 12, Italy, 1 upload, today' }),
    ).toBeTruthy();

    await act(async () => {
      await update?.mutateAsync({ cuisineCode: 'JP', description: null, isPublic: true });
    });

    expect(
      await screen.findByRole('button', { name: 'Nov 12, Japan, 1 upload, today' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nov 12, Italy, 1 upload, today' })).toBeNull();
  });
});
