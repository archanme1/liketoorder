import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as sellersApi from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { RequestAppError, cancelPickupRequest, countWaitingRequests, listMyRequests } from '../api';
import { requestKeys } from '../hooks/keys';
import { useCancelPickupRequest } from '../hooks/useCancelPickupRequest';
import { useRequestsBadge, useRequestsCounts } from '../hooks/useRequestsBadge';
import { clearStatusMemory } from '../statusMemory';

import { makeRequest } from '../__fixtures__/requests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
  cancelPickupRequest: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const listMock = jest.mocked(listMyRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const cancelMock = jest.mocked(cancelPickupRequest);
const businessMock = jest.mocked(sellersApi.getMyBusiness);

const NOW = '2026-11-08T17:00:00Z';
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));
const ownerBusiness = { id: 'b1' } as unknown as MyBusiness;

function auth(userId: string | null): AuthContextValue {
  return {
    session: userId ? ({ user: { id: userId } } as unknown as AuthContextValue['session']) : null,
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
let userId: string | null;
// A new user id per test: a write that lands late from one test can never reach the next.
let counter = 0;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={auth(userId)}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

const serve = (...requests: ReturnType<typeof makeRequest>[]) =>
  listMock.mockResolvedValue({ server_now: NOW, requests, next_cursor: null });
// Waits for the value, then makes sure it stays: a number that flickers back is a failure too.
async function settled(read: () => number | undefined, expected: number) {
  await waitFor(() => expect(read()).toBe(expected));
  await act(flush);
  await act(flush);
  expect(read()).toBe(expected);
}
const refetchList = () => act(() => client.invalidateQueries({ queryKey: requestKeys.mine }));

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

describe('the customer badge (spec 10b Decision 7)', () => {
  it('shows no number while the list or the phone memory is loading', async () => {
    listMock.mockReturnValue(new Promise(() => undefined));
    const { result } = await renderHook(() => useRequestsBadge(), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it('shows no number when the list fails to load (never a wrong number)', async () => {
    listMock.mockRejectedValue(new RequestAppError('network'));
    const { result } = await renderHook(() => useRequestsBadge(), { wrapper });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await act(flush);
    expect(result.current).toBeUndefined();
  });

  it('treats the first load on a phone as the baseline: no badge for existing requests, not even for a moment', async () => {
    serve(
      makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }),
      makeRequest({ id: 'b', status: 'declined', display_status: 'declined' }),
    );
    const shown: (number | undefined)[] = [];
    const useRecorded = () => {
      const counts = useRequestsCounts();
      shown.push(counts.sent);
      return counts;
    };
    const { result } = await renderHook(useRecorded, { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    await act(flush);
    expect(shown.filter((value) => value !== undefined && value > 0)).toEqual([]);
  });

  it('counts a request the seller answered since it was last seen', async () => {
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }));
    await refetchList();
    await waitFor(() => expect(result.current.sent).toBe(1));
    expect(result.current.total).toBe(1);
  });

  it('counts a pending request that expired, using the server status and not the phone clock', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'));
    serve(makeRequest({ id: 'a', expires_at: '2026-11-08T17:30:00+00:00' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    // The phone says 2030: the request is long past its expiry, but the server still says pending.
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(makeRequest({ id: 'a', status: 'pending', display_status: 'expired' }));
    await refetchList();
    await waitFor(() => expect(result.current.sent).toBe(1));
  });

  it('clears the number when the Sent list is opened (markSentSeen) and keeps it cleared', async () => {
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(makeRequest({ id: 'a', status: 'declined', display_status: 'declined' }));
    await refetchList();
    await waitFor(() => expect(result.current.sent).toBe(1));
    await act(async () => result.current.markSentSeen());
    await waitFor(() => expect(result.current.sent).toBe(0));
    await refetchList();
    await act(flush);
    expect(result.current.sent).toBe(0);
  });

  it('does not let another user on the same phone inherit the number', async () => {
    serve(makeRequest({ id: 'a' }));
    const first = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(first.result.current.sent).toBe(0));
    await first.unmount();
    client.clear();

    userId = `${userId}-other`;
    serve(makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }));
    const second = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(second.result.current.sent).toBe(0));
  });

  it('makes no requests and shows nothing for a guest', async () => {
    userId = null;
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await act(flush);
    expect(result.current.total).toBeUndefined();
    expect(listMock).not.toHaveBeenCalled();
    expect(waitingMock).not.toHaveBeenCalled();
  });
});

describe('the stored copy cannot be read', () => {
  it('shows no number, does not loop, and reads again when a screen mounts next', async () => {
    serve(makeRequest({ id: 'a' }));
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    // Only the status memory's own key fails (the supabase client reads its own keys too).
    getItem.mockImplementation(async (key) => {
      if (key === memoryKey && reads === 0) {
        reads += 1;
        throw new Error('disk');
      }
      return null;
    });
    const memoryKey = `liketoorder.requests.seen.v1.${userId}`;
    const memoryReads = () => getItem.mock.calls.filter(([key]) => key === memoryKey).length;
    let reads = 0;
    const first = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(memoryReads()).toBe(1));
    await act(flush);
    await act(flush);
    expect(first.result.current.sent).toBeUndefined();
    // One failed read, not a tight retry loop.
    expect(memoryReads()).toBe(1);
    await first.unmount();

    const second = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(second.result.current.sent).toBe(0));
    expect(memoryReads()).toBe(2);
  });
});

describe('own cancel is not news (Decision 18)', () => {
  const useBoth = () => ({ counts: useRequestsCounts(), cancel: useCancelPickupRequest() });

  it('does not raise the badge when the person cancels, also after the list is re-read', async () => {
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(0));

    cancelMock.mockResolvedValue(
      makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }),
    );
    serve(makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }));
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    await act(flush);
    await refetchList();
    await settled(() => result.current.counts.sent, 0);
  });

  it('keeps the number as it was when the cancel fails and is retried', async () => {
    serve(makeRequest({ id: 'a' }), makeRequest({ id: 'b' }));
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(0));
    // b was answered by the seller: one real change.
    serve(
      makeRequest({ id: 'a' }),
      makeRequest({ id: 'b', status: 'accepted', display_status: 'accepted' }),
    );
    await refetchList();
    await waitFor(() => expect(result.current.counts.sent).toBe(1));

    cancelMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(result.current.cancel.isError).toBe(true));
    expect(result.current.counts.sent).toBe(1);

    cancelMock.mockResolvedValueOnce(
      makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }),
    );
    serve(
      makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }),
      makeRequest({ id: 'b', status: 'accepted', display_status: 'accepted' }),
    );
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(2));
    await act(flush);
    await refetchList();
    // Still only the seller's answer on b.
    await settled(() => result.current.counts.sent, 1);
  });

  it('still counts a seller answer and an expiry that come after a cancel of another request', async () => {
    serve(makeRequest({ id: 'a' }), makeRequest({ id: 'b' }));
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(0));
    cancelMock.mockResolvedValue(
      makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }),
    );
    serve(
      makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }),
      makeRequest({ id: 'b', status: 'pending', display_status: 'expired' }),
    );
    await act(async () => result.current.cancel.cancelRequest('a'));
    await act(flush);
    await refetchList();
    await waitFor(() => expect(result.current.counts.sent).toBe(1));
  });
});

describe('the business owner numbers', () => {
  it('adds the waiting requests to the customer updates, and each part is its own number', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockResolvedValue({ server_now: NOW, waiting: 2 });
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }));
    await refetchList();
    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current.isOwner).toBe(true);
    expect(result.current.received).toBe(2);
    expect(result.current.sent).toBe(1);
  });

  it('never calls the waiting count for a customer without a business', async () => {
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(0));
    expect(result.current.isOwner).toBe(false);
    expect(result.current.received).toBeUndefined();
    expect(waitingMock).not.toHaveBeenCalled();
  });

  it('shows no total while it is not known whether the person owns a business', async () => {
    businessMock.mockReturnValue(new Promise(() => undefined));
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await act(flush);
    expect(result.current.isOwner).toBeUndefined();
    expect(result.current.total).toBeUndefined();
  });

  it('shows no number for a waiting count that failed, not zero', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockRejectedValue(new RequestAppError('network'));
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    await act(flush);
    expect(result.current.received).toBeUndefined();
  });

  it('shows no tab total when the waiting count failed, even with a Sent change to show', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockRejectedValue(new RequestAppError('network'));
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }));
    await refetchList();
    await settled(() => result.current.sent, 1);
    // The Sent switch has its number, but the tab would say 1 when the real total is higher.
    expect(result.current.received).toBeUndefined();
    expect(result.current.total).toBeUndefined();
  });

  it('shows no tab total while the waiting count is still loading', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockReturnValue(new Promise(() => undefined));
    serve(makeRequest({ id: 'a' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    expect(result.current.total).toBeUndefined();
  });
});
