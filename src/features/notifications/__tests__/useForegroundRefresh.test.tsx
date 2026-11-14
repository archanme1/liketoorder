import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { requestKeys } from '@/features/requests/hooks/keys';

import { useForegroundRefresh } from '../hooks/useForegroundRefresh';

import {
  REQUEST_UUID,
  fakeNotifications,
  makeNotification,
  pushData,
} from '../__fixtures__/notifications';

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

const invalidated = (spy: jest.SpyInstance) =>
  spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));

describe('useForegroundRefresh (stale-list rule)', () => {
  it('a customer push re-reads the lists, the counts and that request', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    await renderHook(() => useForegroundRefresh(), { wrapper });
    await act(async () => fakeNotifications.__emitReceived(makeNotification(pushData())));
    expect(invalidated(spy).sort()).toEqual(
      [
        requestKeys.mine,
        requestKeys.inboxAll,
        requestKeys.waitingCount,
        requestKeys.updatesCount,
        requestKeys.detail(REQUEST_UUID),
      ]
        .map((key) => JSON.stringify(key))
        .sort(),
    );
  });

  it('an owner push re-reads the owner detail of that request', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    await renderHook(() => useForegroundRefresh(), { wrapper });
    await act(async () =>
      fakeNotifications.__emitReceived(makeNotification(pushData({ side: 'received' }))),
    );
    expect(invalidated(spy)).toContain(JSON.stringify(requestKeys.businessDetail(REQUEST_UUID)));
    expect(invalidated(spy)).not.toContain(JSON.stringify(requestKeys.detail(REQUEST_UUID)));
  });

  it('a push with a bad payload still re-reads the lists and counts, and no detail', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    await renderHook(() => useForegroundRefresh(), { wrapper });
    await act(async () => fakeNotifications.__emitReceived(makeNotification({ foo: 'bar' })));
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('stops listening when unmounted', async () => {
    const view = await renderHook(() => useForegroundRefresh(), { wrapper });
    await view.unmount();
    expect(fakeNotifications.__listenerCount()).toBe(0);
  });
});
