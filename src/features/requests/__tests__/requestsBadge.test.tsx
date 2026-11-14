import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as sellersApi from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import {
  RequestAppError,
  cancelPickupRequest,
  countMyRequestUpdates,
  countWaitingRequests,
  listMyRequests,
  markMyRequestsSeen,
} from '../api';
import { requestKeys } from '../hooks/keys';
import { useCancelPickupRequest } from '../hooks/useCancelPickupRequest';
import { useRequestsBadge, useRequestsCounts } from '../hooks/useRequestsBadge';

import { makeRequest } from '../__fixtures__/requests';

// Spec 12: the customer's "changed" number is the server's (count_my_request_updates), the same on
// every phone. The server decides what counts (an answer, an expiry, completed, no-show; never the
// customer's own cancel; existing rows start as seen): pgTAP covers that. Here: the app shows the
// server's number, clears it through mark_my_requests_seen, and never invents one.

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
  countMyRequestUpdates: jest.fn(),
  markMyRequestsSeen: jest.fn(),
  cancelPickupRequest: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const listMock = jest.mocked(listMyRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const updatesMock = jest.mocked(countMyRequestUpdates);
const markSeenMock = jest.mocked(markMyRequestsSeen);
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
let counter = 0;
/** The server's flag count for the signed-in customer. */
let serverUpdates = 0;
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
const refetchCount = () =>
  act(() => client.invalidateQueries({ queryKey: requestKeys.updatesCount }));
const refetchList = () => act(() => client.invalidateQueries({ queryKey: requestKeys.mine }));

beforeEach(async () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  counter += 1;
  userId = `user-${counter}`;
  serverUpdates = 0;
  await AsyncStorage.clear();
  jest.clearAllMocks();
  businessMock.mockResolvedValue(null);
  waitingMock.mockResolvedValue({ server_now: NOW, waiting: 0 });
  updatesMock.mockImplementation(async () => serverUpdates);
  markSeenMock.mockImplementation(async () => {
    serverUpdates = 0;
  });
  serve(makeRequest({ id: 'a' }));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

describe('the customer badge (spec 10b Decision 7, server flag since spec 12)', () => {
  it('shows no number while the count is loading', async () => {
    updatesMock.mockReturnValue(new Promise(() => undefined));
    const { result } = await renderHook(() => useRequestsBadge(), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it('shows no number when the count fails to load (never a wrong number)', async () => {
    updatesMock.mockRejectedValue(new RequestAppError('network'));
    const { result } = await renderHook(() => useRequestsBadge(), { wrapper });
    await waitFor(() => expect(updatesMock).toHaveBeenCalled());
    await act(flush);
    expect(result.current).toBeUndefined();
  });

  it("shows the server's number: none, then one after the seller answers", async () => {
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serverUpdates = 1;
    await refetchCount();
    await waitFor(() => expect(result.current.sent).toBe(1));
    expect(result.current.total).toBe(1);
  });

  it('reads the number again after every Sent list read, so a change the list shows is counted', async () => {
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    // Mount the list itself (the badge no longer reads it), then let it re-read.
    await act(() =>
      client.fetchQuery({ queryKey: requestKeys.mine, queryFn: () => listMyRequests() }),
    );
    serverUpdates = 2;
    serve(makeRequest({ id: 'a', status: 'accepted', display_status: 'accepted' }));
    await refetchList();
    await act(() =>
      client.fetchQuery({ queryKey: requestKeys.mine, queryFn: () => listMyRequests() }),
    );
    await waitFor(() => expect(result.current.sent).toBe(2));
  });

  it('clears the number when the Sent list is opened (markSentSeen), then reads it again', async () => {
    serverUpdates = 1;
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(1));
    await act(async () => result.current.markSentSeen());
    await waitFor(() => expect(markSeenMock).toHaveBeenCalledTimes(1));
    await settled(() => result.current.sent, 0);
    expect(updatesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not call the server to clear a number that is already zero', async () => {
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    await act(async () => result.current.markSentSeen());
    await act(flush);
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it('sends one clear at a time, and a failed clear only reads the number again', async () => {
    serverUpdates = 3;
    let release: () => void = () => undefined;
    markSeenMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new RequestAppError('network'));
        }),
    );
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(3));
    await act(async () => result.current.markSentSeen());
    await act(async () => result.current.markSentSeen());
    expect(markSeenMock).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await settled(() => result.current.sent, 3);
  });

  it('makes no requests and shows nothing for a guest', async () => {
    userId = null;
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await act(flush);
    expect(result.current.total).toBeUndefined();
    expect(updatesMock).not.toHaveBeenCalled();
    expect(waitingMock).not.toHaveBeenCalled();
  });
});

describe('own cancel is not news (Decision 18)', () => {
  const useBoth = () => ({ counts: useRequestsCounts(), cancel: useCancelPickupRequest() });

  it('a cancel neither clears nor raises the number, and does not touch the flags', async () => {
    serverUpdates = 1;
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(1));
    cancelMock.mockResolvedValue(
      makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }),
    );
    serve(makeRequest({ id: 'a', status: 'cancelled', display_status: 'cancelled' }));
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    await refetchCount();
    // The server does not flag an own cancel: the earlier answer is still the only change.
    await settled(() => result.current.counts.sent, 1);
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it('a failed cancel keeps the number as it was', async () => {
    serverUpdates = 1;
    const { result } = await renderHook(useBoth, { wrapper });
    await waitFor(() => expect(result.current.counts.sent).toBe(1));
    cancelMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => result.current.cancel.cancelRequest('a'));
    await waitFor(() => expect(result.current.cancel.isError).toBe(true));
    await settled(() => result.current.counts.sent, 1);
  });
});

describe('the business owner numbers', () => {
  it('adds the waiting requests to the customer updates, and each part is its own number', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockResolvedValue({ server_now: NOW, waiting: 2 });
    serverUpdates = 1;
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current.isOwner).toBe(true);
    expect(result.current.received).toBe(2);
    expect(result.current.sent).toBe(1);
  });

  it('never calls the waiting count for a customer without a business', async () => {
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(0));
    expect(result.current.isOwner).toBe(false);
    expect(result.current.received).toBeUndefined();
    expect(waitingMock).not.toHaveBeenCalled();
  });

  it('shows no total while it is not known whether the person owns a business', async () => {
    businessMock.mockReturnValue(new Promise(() => undefined));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await act(flush);
    expect(result.current.isOwner).toBeUndefined();
    expect(result.current.total).toBeUndefined();
  });

  it('shows no number for a waiting count that failed, not zero', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockRejectedValue(new RequestAppError('network'));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    await act(flush);
    expect(result.current.received).toBeUndefined();
  });

  it('shows no tab total when the waiting count failed, even with a Sent change to show', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockRejectedValue(new RequestAppError('network'));
    serverUpdates = 1;
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await settled(() => result.current.sent, 1);
    // The Sent switch has its number, but the tab would say 1 when the real total is higher.
    expect(result.current.received).toBeUndefined();
    expect(result.current.total).toBeUndefined();
  });

  it('shows no tab total while the waiting count is still loading', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockReturnValue(new Promise(() => undefined));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    expect(result.current.total).toBeUndefined();
  });
});
