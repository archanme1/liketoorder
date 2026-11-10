import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as sellersApi from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { countWaitingRequests, listMyRequests } from '../api';
import { requestKeys } from '../hooks/keys';
import { useRequestsBadge, useRequestsCounts } from '../hooks/useRequestsBadge';
import { clearStatusMemory } from '../statusMemory';

import { makeRequest } from '../__fixtures__/requests';
import { makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const listMock = jest.mocked(listMyRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const businessMock = jest.mocked(sellersApi.getMyBusiness);

const NOW = '2026-11-08T17:00:00Z';
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));
const ownerBusiness = { id: 'b1' } as unknown as MyBusiness;

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

type Row = ReturnType<typeof makeTableRequest> | ReturnType<typeof makeRequest>;
const serve = (...requests: Row[]) =>
  listMock.mockResolvedValue({ server_now: NOW, requests, next_cursor: null });
const refetchList = () => act(() => client.invalidateQueries({ queryKey: requestKeys.mine }));
const answered = (id: string, status: 'accepted' | 'declined' | 'expired') =>
  makeTableRequest({ id, status, display_status: status });
// Waits for the value, then makes sure it stays: a number that flickers back is a failure too.
async function settled(read: () => number | undefined, expected: number) {
  await waitFor(() => expect(read()).toBe(expected));
  await act(flush);
  await act(flush);
  expect(read()).toBe(expected);
}

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  counter += 1;
  userId = `user-${counter}`;
  clearStatusMemory();
  await flush();
  await AsyncStorage.clear();
  listMock.mockReset();
  waitingMock.mockReset();
  businessMock.mockReset();
  businessMock.mockResolvedValue(null);
  waitingMock.mockResolvedValue({ server_now: NOW, waiting: 0 });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

describe('the customer badge with table requests', () => {
  it('first sight is a baseline: table requests already answered raise nothing', async () => {
    serve(answered('t1', 'accepted'), answered('t2', 'declined'), makeTableRequest({ id: 't3' }));
    const { result } = await renderHook(() => useRequestsBadge(), { wrapper });
    await waitFor(() => expect(result.current).toBe(0));
  });

  it('the restaurant answering a table request raises it by one, pickup and table alike', async () => {
    serve(makeTableRequest({ id: 't1' }), makeRequest({ id: 'p1' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(answered('t1', 'accepted'), makeRequest({ id: 'p1' }));
    await refetchList();
    await settled(() => result.current.sent, 1);
    serve(
      answered('t1', 'accepted'),
      makeRequest({ id: 'p1', status: 'declined', display_status: 'declined' }),
    );
    await refetchList();
    await settled(() => result.current.sent, 2);
  });

  it('a table request that expired (the server says so) raises it', async () => {
    serve(makeTableRequest({ id: 't1' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(answered('t1', 'expired'));
    await refetchList();
    await settled(() => result.current.sent, 1);
  });

  it('I have arrived changes no status, so it raises nothing', async () => {
    serve(answered('t1', 'accepted'));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve({ ...answered('t1', 'accepted'), arrived_at: '2026-11-08T23:30:00+00:00' });
    await refetchList();
    await settled(() => result.current.sent, 0);
  });

  it('a wrong phone clock changes nothing: only the server display_status counts (skewed clock)', async () => {
    // The request expires at 2026-11-09 00:00 UTC. The server still calls it pending.
    serve(makeTableRequest({ id: 't1' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));

    // The phone's clock jumps a year ahead: past the expiry by the phone's own reckoning.
    const real = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(real + 365 * 24 * 3_600_000);
    serve(makeTableRequest({ id: 't1' }));
    await refetchList();
    await settled(() => result.current.sent, 0);

    // And the other way: the phone's clock is a year behind, but the server says Expired.
    jest.spyOn(Date, 'now').mockReturnValue(real - 365 * 24 * 3_600_000);
    serve(answered('t1', 'expired'));
    await refetchList();
    await settled(() => result.current.sent, 1);
  });
});

describe('the business owner total with table requests', () => {
  it('owner total is the server waiting count (both kinds) plus the customer updates', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockResolvedValue({ server_now: NOW, waiting: 3 });
    serve(makeTableRequest({ id: 't1' }));
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serve(answered('t1', 'declined'));
    await refetchList();
    await waitFor(() => expect(result.current.total).toBe(4));
    expect(result.current.received).toBe(3);
    expect(result.current.sent).toBe(1);
  });
});
