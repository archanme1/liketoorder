import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useNotificationPermission } from '../hooks/useNotificationPermission';

const getPermission = jest.mocked(Notifications.getPermissionsAsync);
const askPermission = jest.mocked(Notifications.requestPermissionsAsync);
const defaultGet = getPermission.getMockImplementation();
const defaultAsk = askPermission.getMockImplementation();

function permission(status: 'undetermined' | 'granted' | 'denied') {
  getPermission.mockResolvedValue({
    status,
    granted: status === 'granted',
    canAskAgain: status !== 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
  getPermission.mockImplementation(defaultGet);
  askPermission.mockImplementation(defaultAsk);
  jest.clearAllMocks();
});

describe('useNotificationPermission', () => {
  it('reads the phone state: never asked', async () => {
    const { result } = await renderHook(() => useNotificationPermission(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('undetermined'));
  });

  it('asks, then reports the answer to every user of the hook', async () => {
    const first = await renderHook(() => useNotificationPermission(), { wrapper });
    const second = await renderHook(() => useNotificationPermission(), { wrapper });
    await waitFor(() => expect(first.result.current.state).toBe('undetermined'));

    permission('granted');
    await act(async () => {
      await expect(first.result.current.request()).resolves.toBe('granted');
    });
    expect(askPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(second.result.current.state).toBe('granted'));
  });

  it('re-reads when the app comes back from Settings, not when it goes to the background', async () => {
    const listeners: ((status: AppStateStatus) => void)[] = [];
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listeners.push(handler);
      return { remove };
    });
    permission('denied');
    const { result, unmount } = await renderHook(() => useNotificationPermission(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('denied'));

    permission('granted');
    await act(async () => listeners.forEach((listener) => listener('active')));
    await waitFor(() => expect(result.current.state).toBe('granted'));

    getPermission.mockClear();
    await act(async () => listeners.forEach((listener) => listener('background')));
    expect(getPermission).not.toHaveBeenCalled();

    await unmount();
    expect(remove).toHaveBeenCalled();
  });
});
