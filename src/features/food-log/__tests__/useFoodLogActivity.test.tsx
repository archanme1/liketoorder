import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { getCalendars } from 'expo-localization';
import type { ReactNode } from 'react';

import { activityJson, resetModuleMocks, testClientOptions } from '../__fixtures__/foodLog';
import { getMyFoodLogActivity } from '../api';
import { foodLogActivityKey } from '../hooks/keys';
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
