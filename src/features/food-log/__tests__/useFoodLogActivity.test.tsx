import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { getCalendars } from 'expo-localization';
import type { ReactNode } from 'react';

import { activityJson, resetModuleMocks, testClientOptions } from '../__fixtures__/foodLog';
import { getMyFoodLogActivity } from '../api';
import { foodLogActivityKey } from '../hooks/keys';
import { useActivityRefresh } from '../hooks/useActivityRefresh';
import { useFoodLogActivity } from '../hooks/useFoodLogActivity';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
}));

const mockedActivity = jest.mocked(getMyFoodLogActivity);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient(testClientOptions());
  mockedActivity.mockResolvedValue(activityJson());
});

afterEach(async () => {
  await cleanup();
  client.clear();
  // Back to react-query's own focus detection.
  focusManager.setFocused(undefined);
  jest.clearAllMocks();
  resetModuleMocks('../api');
});

describe('useFoodLogActivity', () => {
  it("sends the phone's zone (getCalendars) and the week count", async () => {
    const { result } = await renderHook(() => useFoodLogActivity(17), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getCalendars()[0].timeZone).toBe('UTC');
    expect(mockedActivity).toHaveBeenCalledWith('UTC', 17);
    expect(result.current.data).toEqual(activityJson());
  });

  it('keeps 17 and 53 weeks apart', async () => {
    await renderHook(() => useFoodLogActivity(53), { wrapper });
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledWith('UTC', 53));
    expect(client.getQueryData(foodLogActivityKey(53))).toBeDefined();
    expect(client.getQueryData(foodLogActivityKey(17))).toBeUndefined();
  });

  it('is fresh for 60 s with no polling', async () => {
    // Review Q4: this client keeps unused data, so the remount below finds it whatever the timing
    // of garbage collection (gcTime 0 could drop it between unmount and remount).
    client.clear();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
    });
    const first = await renderHook(() => useFoodLogActivity(17), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: foodLogActivityKey(17) });
    expect(query?.options).toMatchObject({ staleTime: 60_000 });
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();

    // A second screen mounting inside the 60 s reuses the data.
    await first.unmount();
    const second = await renderHook(() => useFoodLogActivity(17), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mockedActivity).toHaveBeenCalledTimes(1);
  });

  it('refetches when the app comes back to the foreground once stale, not while fresh', async () => {
    const { result } = await renderHook(() => useFoodLogActivity(17), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Fresh: back to the foreground does nothing.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(mockedActivity).toHaveBeenCalledTimes(1);

    // Stale (fetched over 60 s ago, set without a timer): back to the foreground refetches.
    client.setQueryData(foodLogActivityKey(17), activityJson(), {
      updatedAt: Date.now() - 61_000,
    });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(mockedActivity).toHaveBeenCalledTimes(2));
  });
});

describe('useActivityRefresh (review Q9)', () => {
  it("refetches only that screen's week count, even with Profile mounted underneath", async () => {
    // Profile (17 weeks) stays mounted under Your year (53 weeks).
    const { result } = await renderHook(
      () => ({
        profile: useFoodLogActivity(17),
        year: useFoodLogActivity(53),
        refresh: useActivityRefresh(53),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.year.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.profile.isSuccess).toBe(true));
    expect(mockedActivity).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.refresh.onRefresh();
    });
    expect(mockedActivity).toHaveBeenCalledTimes(3);
    expect(mockedActivity).toHaveBeenLastCalledWith('UTC', 53);
    expect(result.current.refresh.refreshing).toBe(false);
  });
});
