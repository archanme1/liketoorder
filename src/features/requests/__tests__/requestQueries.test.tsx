import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  cancelPickupRequest,
  getMyPickupAddress,
  getPickupRequest,
  listMyPickupRequests,
  RequestAppError,
} from '../api';
import { requestKeys } from '../hooks/keys';
import { useCancelPickupRequest } from '../hooks/useCancelPickupRequest';
import { useMyRequests } from '../hooks/useMyRequests';
import { canShowAddress, usePickupAddress } from '../hooks/usePickupAddress';
import { usePickupRequest } from '../hooks/usePickupRequest';
import { useRefetchAtExpiry } from '../hooks/useRefetchAtExpiry';

import { makeRequest, REQUEST_ID } from '../__fixtures__/requests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  cancelPickupRequest: jest.fn(),
  getMyPickupAddress: jest.fn(),
  getPickupRequest: jest.fn(),
  listMyPickupRequests: jest.fn(),
}));

const listMock = jest.mocked(listMyPickupRequests);
const getMock = jest.mocked(getPickupRequest);
const addressMock = jest.mocked(getMyPickupAddress);
const cancelMock = jest.mocked(cancelPickupRequest);

// react-query only re-renders for props read during render; the hooks read `data`, so the tests
// read everything too (components read what they show).
const all = <T extends object>(query: T): T => ({ ...query });

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SERVER_NOW = '2026-11-08T17:00:00Z';
const pending = makeRequest();
const homemadeAccepted = makeRequest({
  business_type: 'homemade',
  status: 'accepted',
  display_status: 'accepted',
});

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  [listMock, getMock, addressMock, cancelMock].forEach((mock) => mock.mockReset());
});

afterEach(() => {
  client.clear();
  cleanup();
  jest.useRealTimers();
});

describe('useMyRequests', () => {
  it('loads the list', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, requests: [pending] });
    const { result } = await renderHook(() => all(useMyRequests()), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.requests).toEqual([pending]);
  });

  it('surfaces an error that Retry can re-send', async () => {
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    const { result } = await renderHook(() => all(useMyRequests()), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    listMock.mockResolvedValueOnce({ server_now: SERVER_NOW, requests: [] });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('re-reads every 30 seconds while a pending request is visible', async () => {
    jest.useFakeTimers({ now: Date.parse(SERVER_NOW) });
    listMock.mockResolvedValue({ server_now: SERVER_NOW, requests: [pending] });
    await renderHook(() => all(useMyRequests()), { wrapper });
    await act(async () => undefined);
    expect(listMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not poll when nothing is pending', async () => {
    jest.useFakeTimers({ now: Date.parse(SERVER_NOW) });
    const done = makeRequest({ status: 'declined', display_status: 'declined' });
    listMock.mockResolvedValue({ server_now: SERVER_NOW, requests: [done] });
    await renderHook(() => all(useMyRequests()), { wrapper });
    await act(async () => undefined);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

describe('usePickupRequest', () => {
  it('loads one request, and null for not found', async () => {
    getMock.mockResolvedValue({ server_now: SERVER_NOW, request: null });
    const { result } = await renderHook(() => all(usePickupRequest(REQUEST_ID)), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.request).toBeNull();
    expect(getMock).toHaveBeenCalledWith(REQUEST_ID);
  });
});

describe('useCancelPickupRequest', () => {
  it('refetches the list and the detail after a cancel', async () => {
    cancelMock.mockResolvedValue(makeRequest({ status: 'cancelled', display_status: 'cancelled' }));
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useCancelPickupRequest(), { wrapper });
    await act(async () => result.current.mutate(REQUEST_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cancelMock).toHaveBeenCalledWith(REQUEST_ID);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.mine });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.detail(REQUEST_ID) });
  });

  it('also refetches after a failure (the request may have expired meanwhile)', async () => {
    cancelMock.mockRejectedValue(new RequestAppError('invalid_transition'));
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useCancelPickupRequest(), { wrapper });
    await act(async () => result.current.mutate(REQUEST_ID));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe('invalid_transition');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.mine });
  });
});

describe('usePickupAddress', () => {
  it('only homemade accepted or completed may show the address', () => {
    expect(canShowAddress(homemadeAccepted)).toBe(true);
    expect(canShowAddress({ ...homemadeAccepted, display_status: 'completed' })).toBe(true);
    expect(canShowAddress({ ...homemadeAccepted, business_type: 'restaurant' })).toBe(false);
    for (const display_status of [
      'pending',
      'declined',
      'expired',
      'cancelled',
      'no_show',
    ] as const) {
      expect(canShowAddress({ ...homemadeAccepted, display_status })).toBe(false);
    }
    expect(canShowAddress(null)).toBe(false);
  });

  it('fetches for an accepted homemade request', async () => {
    addressMock.mockResolvedValue({ formatted_address: '1 King St' });
    const { result } = await renderHook(() => usePickupAddress(REQUEST_ID, homemadeAccepted), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual({ formatted_address: '1 King St' }));
  });

  it.each(['pending', 'declined', 'expired', 'cancelled', 'no_show'] as const)(
    'never asks for the address when the request is %s',
    async (display_status) => {
      const { result } = await renderHook(
        () => usePickupAddress(REQUEST_ID, { ...homemadeAccepted, display_status }),
        { wrapper },
      );
      await act(async () => undefined);
      expect(addressMock).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    },
  );

  it('never asks for a restaurant', async () => {
    await renderHook(
      () => usePickupAddress(REQUEST_ID, { ...homemadeAccepted, business_type: 'restaurant' }),
      { wrapper },
    );
    await act(async () => undefined);
    expect(addressMock).not.toHaveBeenCalled();
  });

  it('removes the cached address when the request leaves accepted/completed', async () => {
    addressMock.mockResolvedValue({ formatted_address: '1 King St' });
    const { result, rerender } = await renderHook(
      (props: { request: typeof homemadeAccepted }) => usePickupAddress(REQUEST_ID, props.request),
      { wrapper, initialProps: { request: homemadeAccepted } },
    );
    await waitFor(() => expect(result.current.data).toBeTruthy());
    // gcTime is 0 in tests, so keep a subscriber-free probe: the cache entry itself must go.
    client.setQueryData(requestKeys.address(REQUEST_ID), { formatted_address: '1 King St' });
    await rerender({
      request: { ...homemadeAccepted, status: 'no_show', display_status: 'no_show' },
    });
    await waitFor(() =>
      expect(client.getQueryData(requestKeys.address(REQUEST_ID))).toBeUndefined(),
    );
  });
});

describe('useRefetchAtExpiry (timed on the server clock)', () => {
  const expiresAt = '2026-11-08T17:30:00Z';
  const serverMs = Date.parse(SERVER_NOW);
  const hour = 3_600_000;

  async function setup(skew: number) {
    jest.useFakeTimers({ now: serverMs + skew });
    const refetch = jest.fn();
    // The data arrived "now" on the phone, whose clock is `skew` ms off the server's.
    await renderHook(() =>
      useRefetchAtExpiry([{ expires_at: expiresAt }], SERVER_NOW, Date.now(), refetch),
    );
    return refetch;
  }

  it.each([0, 5 * hour, -5 * hour])(
    'refetches just after expiry, not before, with the phone %i ms off',
    async (skew) => {
      const refetch = await setup(skew);
      await act(async () => {
        jest.advanceTimersByTime(30 * 60_000 - 1);
      });
      expect(refetch).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1_001);
      });
      expect(refetch).toHaveBeenCalledTimes(1);
    },
  );

  it('does nothing without a pending request', async () => {
    jest.useFakeTimers({ now: serverMs });
    const refetch = jest.fn();
    await renderHook(() => useRefetchAtExpiry([], SERVER_NOW, Date.now(), refetch));
    await act(async () => {
      jest.advanceTimersByTime(60 * 60_000);
    });
    expect(refetch).not.toHaveBeenCalled();
  });
});
