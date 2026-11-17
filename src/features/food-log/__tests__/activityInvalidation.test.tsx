import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import {
  activityJson,
  CUISINES,
  dayJson,
  foodLog,
  resetModuleMocks,
  testClientOptions,
} from '../__fixtures__/foodLog';
import {
  claimFoodLogCleanup,
  deleteFoodLog,
  getFoodLog,
  getMyFoodLogActivity,
  listMyFoodLogsOn,
  updateFoodLog,
} from '../api';
import { ActivitySection } from '../components/ActivitySection';
import { FoodLogDetailScreen } from '../components/FoodLogDetailScreen';
import { useCreateFoodLog, useDeleteFoodLog, useUpdateFoodLog } from '../hooks/useFoodLogMutations';
import { uploadFoodLog } from '../uploadFoodLog';

// Spec 14 "Stale lists": creating, editing or deleting a log marks the activity grid and the day
// panels stale. After a delete from a detail opened from the day panel, the panel (still mounted
// under the detail) no longer shows the row, and the grid and streak shrink.

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  listMyFoodLogsOn: jest.fn(),
  getFoodLog: jest.fn(),
  updateFoodLog: jest.fn(),
  deleteFoodLog: jest.fn(),
  claimFoodLogCleanup: jest.fn(),
}));
jest.mock('../uploadFoodLog', () => ({
  ...jest.requireActual('../uploadFoodLog'),
  uploadFoodLog: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));

const mockedDelete = jest.mocked(deleteFoodLog);
const mockedActivity = jest.mocked(getMyFoodLogActivity);
const mockedDay = jest.mocked(listMyFoodLogsOn);

const KEPT = foodLog(1, { local_date: '2026-11-11', description: 'Ramen' });
const DELETED = foodLog(2, { local_date: '2026-11-12', description: 'Pizza' });

let client: QueryClient;
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  client = new QueryClient(testClientOptions());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest.mocked(claimFoodLogCleanup).mockResolvedValue([]);
  jest.mocked(getFoodLog).mockResolvedValue(DELETED);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
  // The server before and after the delete: today's only upload goes, so the run ending today
  // (Nov 11 + Nov 12) becomes the run ending yesterday (Nov 11).
  const deleted = () => mockedDelete.mock.calls.length > 0;
  mockedActivity.mockImplementation(async () =>
    activityJson({
      days: deleted()
        ? [{ date: '2026-11-11', count: 1 }]
        : [
            { date: '2026-11-11', count: 1 },
            { date: '2026-11-12', count: 1 },
          ],
      stats: {
        total_this_year: deleted() ? 1 : 2,
        current_streak: deleted() ? 1 : 2,
        longest_streak: 2,
        cuisines_tried: 1,
      },
    }),
  );
  mockedDay.mockImplementation(async (date) => {
    if (date === '2026-11-12') return dayJson(deleted() ? [] : [DELETED]);
    if (date === '2026-11-11') return dayJson([KEPT]);
    return dayJson([]);
  });
  mockedDelete.mockResolvedValue();
});

afterEach(async () => {
  await cleanup();
  client.clear();
  alertSpy.mockRestore();
  jest.clearAllMocks();
  resetModuleMocks('../api', '../uploadFoodLog', '@/features/media/api', '@/features/cuisines/api');
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The query keys passed to invalidateQueries, as JSON for easy matching. */
function invalidatedKeys(spy: jest.SpyInstance): string[] {
  return spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
}

describe('mutations mark the activity and the day panels stale', () => {
  const ACTIVITY = JSON.stringify(['food-log', 'activity']);
  const DAY = JSON.stringify(['food-log', 'day']);

  it('create', async () => {
    jest.mocked(uploadFoodLog).mockResolvedValue(DELETED);
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useCreateFoodLog(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({} as Parameters<typeof uploadFoodLog>[0]);
    });
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining([ACTIVITY, DAY]));
  });

  it('update', async () => {
    jest.mocked(updateFoodLog).mockResolvedValue(DELETED);
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useUpdateFoodLog(DELETED.id), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ cuisineCode: 'JP', description: null, isPublic: false });
    });
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining([ACTIVITY, DAY]));
  });

  it('delete', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useDeleteFoodLog(DELETED.id), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(invalidatedKeys(spy)).toEqual(expect.arrayContaining([ACTIVITY, DAY]));
  });
});

describe('a delete from a detail opened from the day panel', () => {
  it('removes the row from the panel and shrinks the grid and the streak', async () => {
    client.setQueryDefaults(['cuisines'], { gcTime: Infinity });
    client.setQueryData(['cuisines'], CUISINES);
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={client}>
          <View>
            <ActivitySection weeks={17} showFullYear />
          </View>
          <FoodLogDetailScreen id={DELETED.id} />
        </QueryClientProvider>
      </SafeAreaProvider>,
    );

    // The day panel for today shows the upload the detail page is open on.
    await fireEvent.press(await screen.findByTestId('activity-cell-2026-11-12'));
    expect(await screen.findByRole('button', { name: 'Food photo, Italy. Pizza.' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Nov 12, 1 upload, today', selected: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Current streak, 2 days')).toBeTruthy();

    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this photo' }));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Food photo, Italy. Pizza.' })).toBeNull(),
    );
    expect(await screen.findByText('Nothing logged on Thu, Nov 12, 2026.')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Nov 12, no uploads, today', selected: true }),
    ).toBeTruthy();
    // Deleting can shorten a streak.
    expect(await screen.findByLabelText('Current streak, 1 day')).toBeTruthy();
    expect(mockedActivity).toHaveBeenCalledTimes(2);
    expect(mockedDay.mock.calls.filter(([date]) => date === '2026-11-12')).toHaveLength(2);
  });
});
