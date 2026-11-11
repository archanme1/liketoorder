import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';

import {
  cancelPickupRequest,
  getMyTableRequest,
  getPickupRequest,
  listBusinessRequests,
  listMyRequests,
  respondToRequest,
} from '../api';
import { PENDING_POLL_MS, mineKey, requestKeys } from '../hooks/keys';
import { useBusinessRequests } from '../hooks/useBusinessRequests';
import { useCancelPickupRequest } from '../hooks/useCancelPickupRequest';
import { useCustomerRequest } from '../hooks/useCustomerRequest';
import { useCustomerUpdates } from '../hooks/useCustomerUpdates';
import { flattenPages, useMyRequests } from '../hooks/useMyRequests';
import { useRespondToRequest } from '../hooks/useRespondToRequest';
import type { CustomerRequest, SellerRequest } from '../schema';
import { clearStatusMemory } from '../statusMemory';

import { makeRows, pagedServer } from '../__fixtures__/pagedServer';
import { makeSellerRows, sellerPagedServer } from '../__fixtures__/sellerRequests';
import { TABLE_REQUEST_ID, makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  listBusinessRequests: jest.fn(),
  respondToRequest: jest.fn(),
  cancelPickupRequest: jest.fn(),
  getPickupRequest: jest.fn(),
  getMyTableRequest: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() }, rpc: jest.fn() },
}));

const mineMock = jest.mocked(listMyRequests);
const inboxMock = jest.mocked(listBusinessRequests);
const respondMock = jest.mocked(respondToRequest);
const cancelMock = jest.mocked(cancelPickupRequest);
const pickupMock = jest.mocked(getPickupRequest);
const tableMock = jest.mocked(getMyTableRequest);
const NOW = '2026-11-08T17:00:00Z';
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

const sent: { rows: CustomerRequest[] } = { rows: [] };
const inbox: { rows: SellerRequest[] } = { rows: [] };
let client: QueryClient;
let counter = 0;
let userId: string;

const auth = (): AuthContextValue => ({
  session: { user: { id: userId } } as unknown as AuthContextValue['session'],
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
});
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={auth()}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

/** Rows of one status each, ids ...0001 upward, newest first. */
function sentWith(statuses: CustomerRequest['status'][]): CustomerRequest[] {
  return makeRows(statuses.length).map((row, i) => ({
    ...row,
    status: statuses[i],
    display_status: statuses[i],
  }));
}
const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id);

beforeEach(async () => {
  counter += 1;
  userId = `user-${counter}`;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clearStatusMemory();
  await flush();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  sent.rows = [];
  inbox.rows = [];
  mineMock.mockImplementation(pagedServer(sent));
  inboxMock.mockImplementation(sellerPagedServer(inbox));
});

afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
  client.clear();
});

describe('query keys', () => {
  it('All is `mine` itself; each other filter has its own key under it', () => {
    expect(mineKey('all')).toEqual(requestKeys.mine);
    expect(mineKey('pending')).toEqual(['requests', 'mine', 'pending']);
    expect(mineKey('accepted')).toEqual(['requests', 'mine', 'accepted']);
    expect(mineKey('declined')).toEqual(['requests', 'mine', 'declined']);
    expect(requestKeys.inbox('accepted')).toEqual(['requests', 'inbox', 'accepted']);
  });

  it('a filtered Sent list is cached under its own key, apart from All', async () => {
    sent.rows = sentWith(['pending', 'declined', 'accepted']);
    const { result } = await renderHook(
      () => ({ all: useMyRequests(), dec: useMyRequests({ filter: 'declined' }) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.dec.requests).toHaveLength(1));
    await waitFor(() => expect(result.current.all.requests).toHaveLength(3));
    expect(flattenPages(client.getQueryData(mineKey('declined')))).toHaveLength(1);
    expect(flattenPages(client.getQueryData(requestKeys.mine))).toHaveLength(3);
    expect(mineMock).toHaveBeenCalledWith(undefined, 'declined');
    // All asks exactly as before (one argument), so the app on main and older tests are unchanged.
    expect(mineMock.mock.calls.filter((call) => call.length === 1)).not.toHaveLength(0);
  });
});

describe('stale lists after an action', () => {
  it('after an accept, the row leaves Received Pending and appears in Received Accepted', async () => {
    inbox.rows = makeSellerRows(2, { status: 'pending' });
    const [first] = inbox.rows;
    respondMock.mockImplementation(async (id) => {
      inbox.rows = inbox.rows.map((r) =>
        r.id === id ? { ...r, status: 'accepted', display_status: 'accepted' } : r,
      );
      return inbox.rows.find((r) => r.id === id) as SellerRequest;
    });
    const { result } = await renderHook(
      () => ({
        pending: useBusinessRequests('pending'),
        accepted: useBusinessRequests('accepted'),
        respond: useRespondToRequest(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.pending.requests).toHaveLength(2));
    expect(result.current.accepted.requests).toHaveLength(0);

    await act(async () => {
      result.current.respond.respond(first.id, 'accepted');
    });
    await waitFor(() => expect(idsOf(result.current.accepted.requests)).toEqual([first.id]));
    expect(idsOf(result.current.pending.requests)).not.toContain(first.id);
  });

  it('after a cancel, the row leaves Sent Pending and stays under All only', async () => {
    sent.rows = sentWith(['pending', 'accepted']);
    const [first] = sent.rows;
    cancelMock.mockImplementation(async (id) => {
      sent.rows = sent.rows.map((r) =>
        r.id === id ? { ...r, status: 'cancelled', display_status: 'cancelled' } : r,
      );
      return sent.rows.find((r) => r.id === id) as never;
    });
    const { result } = await renderHook(
      () => ({
        all: useMyRequests(),
        pending: useMyRequests({ filter: 'pending' }),
        cancel: useCancelPickupRequest(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(idsOf(result.current.pending.requests)).toEqual([first.id]));

    await act(async () => {
      result.current.cancel.cancelRequest(first.id);
    });
    await waitFor(() => expect(result.current.pending.requests).toHaveLength(0));
    await waitFor(() =>
      expect(result.current.all.requests.find((r) => r.id === first.id)?.display_status).toBe(
        'cancelled',
      ),
    );
  });
});

describe('polling', () => {
  it('an empty Sent Pending list is still polled, so a new pending request shows up after 30 s', async () => {
    jest.useFakeTimers();
    sent.rows = sentWith(['declined']);
    const { result } = await renderHook(() => useMyRequests({ filter: 'pending' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.requests).toHaveLength(0);

    sent.rows = [
      ...sent.rows,
      { ...sentWith(['pending'])[0], id: '00000000-0000-4000-8000-0000000000ff' },
    ];
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
  });

  it('an empty Received Pending list is still polled', async () => {
    jest.useFakeTimers();
    inbox.rows = makeSellerRows(2, { status: 'declined' });
    const { result } = await renderHook(() => useBusinessRequests('pending'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    inboxMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
    });
    expect(inboxMock).toHaveBeenCalledWith('pending', undefined);
  });

  it('Accepted and Declined are not polled when no pending row is loaded', async () => {
    jest.useFakeTimers();
    sent.rows = sentWith(['accepted', 'declined']);
    inbox.rows = makeSellerRows(2, { status: 'accepted' });
    const { result } = await renderHook(
      () => ({ acc: useMyRequests({ filter: 'accepted' }), dec: useBusinessRequests('declined') }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.acc.isSuccess && result.current.dec.isSuccess).toBe(true),
    );
    mineMock.mockClear();
    inboxMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS * 2 + 100);
    });
    expect(mineMock).not.toHaveBeenCalled();
    expect(inboxMock).not.toHaveBeenCalled();
  });
});

describe('the Sent badge', () => {
  it('is made from the unfiltered All list even while a filtered list is on screen', async () => {
    sent.rows = sentWith(['pending', 'declined', 'accepted', 'cancelled']);
    const { result } = await renderHook(
      () => ({ updates: useCustomerUpdates(), dec: useMyRequests({ filter: 'declined' }) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.updates.count).toBe(0));
    await waitFor(() => expect(result.current.dec.requests).toHaveLength(1));
    // The badge's list is `mine` (All), holding every row, read with no filter argument.
    expect(flattenPages(client.getQueryData(requestKeys.mine))).toHaveLength(4);
    expect(mineMock.mock.calls.some((call) => call.length === 1 && call[0] === undefined)).toBe(
      true,
    );

    // A status change in a row the filtered list does not show still counts.
    sent.rows = sent.rows.map((r) =>
      r.display_status === 'pending' ? { ...r, status: 'accepted', display_status: 'accepted' } : r,
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: requestKeys.mine });
    });
    await waitFor(() => expect(result.current.updates.count).toBe(1));
  });
});

describe('opening a request from a filtered list', () => {
  it('useCustomerRequest finds the kind in a filtered Sent cache', async () => {
    client.setQueryData(mineKey('declined'), {
      pages: [
        {
          server_now: NOW,
          requests: [makeTableRequest({ status: 'declined', display_status: 'declined' })],
          next_cursor: null,
        },
      ],
      pageParams: [{}],
    });
    tableMock.mockResolvedValue({ server_now: NOW, request: makeTableRequest() });
    const { result } = await renderHook(() => useCustomerRequest(TABLE_REQUEST_ID), { wrapper });
    await waitFor(() => expect(result.current.data?.request?.kind).toBe('table'));
    expect(pickupMock).not.toHaveBeenCalled();
  });
});
