import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import * as sellersApi from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import { countMyRequestUpdates, countWaitingRequests, listMyRequests } from '../api';
import { requestKeys } from '../hooks/keys';
import { useRequestsBadge, useRequestsCounts } from '../hooks/useRequestsBadge';

import { makeTableRequest } from '../__fixtures__/tableRequests';

// Spec 12: the customer number is the server's count of changed requests of BOTH kinds
// (count_my_request_updates); which changes count is the server's rule (pgTAP). Here: table
// requests reach the same number, and nothing on the phone (its clock, an arrival) moves it.

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  countWaitingRequests: jest.fn(),
  countMyRequestUpdates: jest.fn(),
  markMyRequestsSeen: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const listMock = jest.mocked(listMyRequests);
const waitingMock = jest.mocked(countWaitingRequests);
const updatesMock = jest.mocked(countMyRequestUpdates);
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
let counter = 0;
let serverUpdates = 0;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={auth(userId)}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

const serve = (...requests: ReturnType<typeof makeTableRequest>[]) =>
  listMock.mockResolvedValue({ server_now: NOW, requests, next_cursor: null });
const refetchCount = () =>
  act(() => client.invalidateQueries({ queryKey: requestKeys.updatesCount }));
// Waits for the value, then makes sure it stays: a number that flickers back is a failure too.
async function settled(read: () => number | undefined, expected: number) {
  await waitFor(() => expect(read()).toBe(expected));
  await act(flush);
  await act(flush);
  expect(read()).toBe(expected);
}

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
  serve(makeTableRequest({ id: 't1' }));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

describe('the customer badge with table requests', () => {
  it('the restaurant answering a table request raises it by one, pickup and table alike', async () => {
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.sent).toBe(0));
    serverUpdates = 1;
    await refetchCount();
    await settled(() => result.current.sent, 1);
    serverUpdates = 2;
    await refetchCount();
    await settled(() => result.current.sent, 2);
  });

  it("the number is the server's: the badge never reads the request list", async () => {
    serverUpdates = 2;
    const { result } = await renderHook(() => useRequestsBadge(), { wrapper });
    await settled(() => result.current, 2);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('the business owner total with table requests', () => {
  it('owner total is the server waiting count (both kinds) plus the customer updates', async () => {
    businessMock.mockResolvedValue(ownerBusiness);
    waitingMock.mockResolvedValue({ server_now: NOW, waiting: 3 });
    serverUpdates = 1;
    const { result } = await renderHook(() => useRequestsCounts(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(4));
    expect(result.current.received).toBe(3);
    expect(result.current.sent).toBe(1);
  });
});
