import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as sellersApi from '@/features/sellers/api';

import { RequestAppError, cancelTableRequest, countWaitingRequests, listMyRequests } from '../api';
import { requestKeys } from '../hooks/keys';
import { useCancelTableRequest } from '../hooks/useCancelTableRequest';
import { useRequestsCounts } from '../hooks/useRequestsBadge';
import { clearStatusMemory } from '../statusMemory';

import { makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
  cancelTableRequest: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const listMock = jest.mocked(listMyRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const cancelMock = jest.mocked(cancelTableRequest);
const businessMock = jest.mocked(sellersApi.getMyBusiness);

const NOW = '2026-11-08T17:00:00Z';
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

function auth(userId: string): AuthContextValue {
  return {
    session: { user: { id: userId } } as unknown as AuthContextValue['session'],
    isLoading: false,
    isRecovering: false,
    notice: null,
    prepareRecovery: jest.fn(),
    abandonRecovery: jest.fn(),
    markRecovering: jest.fn(),
    clearRecovering: jest.fn(),
    dismissNotice: jest.fn(),
  };
}

let client: QueryClient;
let userId: string;
// A new user id per test: a write that lands late from one test can never reach the next.
let counter = 0;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={auth(userId)}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

const serve = (...requests: ReturnType<typeof makeTableRequest>[]) =>
  listMock.mockResolvedValue({ server_now: NOW, requests, next_cursor: null });
const refetchList = () => act(() => client.invalidateQueries({ queryKey: requestKeys.mine }));
const useBoth = () => ({ counts: useRequestsCounts(), cancel: useCancelTableRequest() });
const cancelled = (id: string) =>
  makeTableRequest({ id, status: 'cancelled', display_status: 'cancelled' });

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  counter += 1;
  userId = `user-${counter}`;
  clearStatusMemory();
  await flush();
  await AsyncStorage.clear();
  listMock.mockReset();
  waitingMock.mockReset();
  cancelMock.mockReset();
  businessMock.mockReset();
  businessMock.mockResolvedValue(null);
  waitingMock.mockResolvedValue({ server_now: NOW, waiting: 0 });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

describe('own cancel of a table request is not news (Decision 18)', () => {
  it('does not raise the badge, also after the list is re-read', async () => {
    serve(makeTableRequest({ id: 'a' }));
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(0));

    cancelMock.mockResolvedValue(cancelled('a'));
    serve(cancelled('a'));
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    await act(flush);
    await refetchList();
    await act(flush);
    await act(flush);
    expect(result.current.counts.sent).toBe(0);
  });

  it('keeps the number as it was when the cancel fails, and raises nothing on the retry', async () => {
    serve(makeTableRequest({ id: 'a' }), makeTableRequest({ id: 'b' }));
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(0));
    // b was answered by the restaurant: one real change.
    serve(
      makeTableRequest({ id: 'a' }),
      makeTableRequest({ id: 'b', status: 'accepted', display_status: 'accepted' }),
    );
    await refetchList();
    await waitFor(() => expect(result.current.counts.sent).toBe(1));

    cancelMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(result.current.cancel.isError).toBe(true));
    expect(result.current.counts.sent).toBe(1);

    cancelMock.mockResolvedValueOnce(cancelled('a'));
    serve(
      cancelled('a'),
      makeTableRequest({ id: 'b', status: 'accepted', display_status: 'accepted' }),
    );
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(2));
    await act(flush);
    await refetchList();
    await act(flush);
    await act(flush);
    expect(result.current.counts.sent).toBe(1);
  });
});

describe('useCancelTableRequest', () => {
  it('sends one cancel on a double tap', async () => {
    serve(makeTableRequest({ id: 'a' }));
    let finish: (value: ReturnType<typeof cancelled>) => void = () => undefined;
    cancelMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = await renderHook(() => useCancelTableRequest(), { wrapper });

    await act(async () => {
      result.current.cancelRequest('a');
      result.current.cancelRequest('a');
    });
    expect(cancelMock).toHaveBeenCalledTimes(1);
    await act(async () => finish(cancelled('a')));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('re-reads Sent and the detail after an error too (the server knows the real status)', async () => {
    cancelMock.mockRejectedValue(new RequestAppError('invalid_transition'));
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useCancelTableRequest(), { wrapper });

    await act(async () => result.current.cancelRequest('a'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.mine });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.detail('a') });
  });
});
