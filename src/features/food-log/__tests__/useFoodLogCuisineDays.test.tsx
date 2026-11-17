import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { getCalendars } from 'expo-localization';
import type { ReactNode } from 'react';

import {
  activityJson,
  cuisineDaysJson,
  resetModuleMocks,
  testClientOptions,
} from '../__fixtures__/foodLog';
import { getMyFoodLogActivity, getMyFoodLogCuisineDays } from '../api';
import { foodLogCuisineDaysKey } from '../hooks/keys';
import { useActivityRefresh } from '../hooks/useActivityRefresh';
import { useFoodLogCuisineDays } from '../hooks/useFoodLogCuisineDays';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  getMyFoodLogCuisineDays: jest.fn(),
}));

const mockedCuisineDays = jest.mocked(getMyFoodLogCuisineDays);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient(testClientOptions());
  mockedCuisineDays.mockResolvedValue(cuisineDaysJson());
  jest.mocked(getMyFoodLogActivity).mockResolvedValue(activityJson());
});

afterEach(async () => {
  await cleanup();
  client.clear();
  // Back to react-query's own focus detection.
  focusManager.setFocused(undefined);
  jest.clearAllMocks();
  resetModuleMocks('../api');
});

describe('useFoodLogCuisineDays (spec 15)', () => {
  it("sends the phone's zone (getCalendars) and the week count", async () => {
    const { result } = await renderHook(() => useFoodLogCuisineDays(17, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getCalendars()[0].timeZone).toBe('UTC');
    expect(mockedCuisineDays).toHaveBeenCalledWith('UTC', 17);
    expect(result.current.data).toEqual(cuisineDaysJson());
  });

  it('sends nothing while disabled (the Activity view), then loads once enabled', async () => {
    const { rerender, result } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useFoodLogCuisineDays(17, enabled),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current.isPending).toBe(true);
    expect(mockedCuisineDays).not.toHaveBeenCalled();

    await rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedCuisineDays).toHaveBeenCalledTimes(1);
  });

  it('is fresh for 60 s with no polling', async () => {
    // This client keeps unused data, so the remount below finds it whatever the timing of
    // garbage collection (as in useFoodLogActivity.test.tsx, review Q4).
    client.clear();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
    });
    const first = await renderHook(() => useFoodLogCuisineDays(17, true), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: foodLogCuisineDaysKey(17) });
    expect(query?.options).toMatchObject({ staleTime: 60_000 });
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();

    await first.unmount();
    const second = await renderHook(() => useFoodLogCuisineDays(17, true), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mockedCuisineDays).toHaveBeenCalledTimes(1);
  });

  it('refetches when the app comes back to the foreground once stale, not while fresh', async () => {
    const { result } = await renderHook(() => useFoodLogCuisineDays(17, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(mockedCuisineDays).toHaveBeenCalledTimes(1);

    client.setQueryData(foodLogCuisineDaysKey(17), cuisineDaysJson(), {
      updatedAt: Date.now() - 61_000,
    });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(mockedCuisineDays).toHaveBeenCalledTimes(2));
  });
});

describe('pull to refresh and the cuisine days (spec 15)', () => {
  it('refetches the cuisine days when the Cuisine view is on screen', async () => {
    const { result } = await renderHook(
      () => ({ cuisine: useFoodLogCuisineDays(17, true), refresh: useActivityRefresh(17) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cuisine.isSuccess).toBe(true));
    expect(mockedCuisineDays).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh.onRefresh();
    });
    expect(mockedCuisineDays).toHaveBeenCalledTimes(2);
    expect(mockedCuisineDays).toHaveBeenLastCalledWith('UTC', 17);
    expect(result.current.refresh.refreshing).toBe(false);
  });

  it('sends no cuisine request when the Activity view is on screen (query disabled)', async () => {
    const { result } = await renderHook(
      () => ({ cuisine: useFoodLogCuisineDays(17, false), refresh: useActivityRefresh(17) }),
      { wrapper },
    );
    await act(async () => {
      await result.current.refresh.onRefresh();
    });
    expect(mockedCuisineDays).not.toHaveBeenCalled();
  });
});
