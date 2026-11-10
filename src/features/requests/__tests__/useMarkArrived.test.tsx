import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RequestAppError, markArrived } from '../api';
import { requestKeys } from '../hooks/keys';
import { useMarkArrived } from '../hooks/useMarkArrived';

import { TABLE_REQUEST_ID, makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  markArrived: jest.fn(),
}));

const arrivedMock = jest.mocked(markArrived);
const accepted = makeTableRequest({ status: 'accepted', display_status: 'accepted' });

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const EVERYTHING = [
  requestKeys.mine,
  requestKeys.detail(TABLE_REQUEST_ID),
  requestKeys.inboxAll,
  requestKeys.businessDetail(TABLE_REQUEST_ID),
  requestKeys.waitingCount,
];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  arrivedMock.mockReset();
});

afterEach(async () => {
  client.clear();
  await cleanup();
});

describe('useMarkArrived', () => {
  it('sends one call on a double tap', async () => {
    let finish: (value: typeof accepted) => void = () => undefined;
    arrivedMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = await renderHook(() => useMarkArrived(), { wrapper });

    await act(async () => {
      result.current.arrived(TABLE_REQUEST_ID);
      result.current.arrived(TABLE_REQUEST_ID);
    });
    expect(arrivedMock).toHaveBeenCalledTimes(1);
    expect(arrivedMock).toHaveBeenCalledWith(TABLE_REQUEST_ID);
    await act(async () => finish(accepted));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('re-reads the lists, the detail, the badge source and the waiting count after a success', async () => {
    arrivedMock.mockResolvedValue({ ...accepted, arrived_at: '2026-11-08T23:30:00+00:00' });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useMarkArrived(), { wrapper });
    await act(async () => result.current.arrived(TABLE_REQUEST_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const queryKey of EVERYTHING) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it.each([
    'already_arrived',
    'arrival_window',
    'invalid_transition',
    'not_found',
    'network',
  ] as const)(
    're-reads the same things after %s, so the screen shows the real state',
    async (code) => {
      arrivedMock.mockRejectedValue(new RequestAppError(code));
      const invalidate = jest.spyOn(client, 'invalidateQueries');
      const { result } = await renderHook(() => useMarkArrived(), { wrapper });
      await act(async () => result.current.arrived(TABLE_REQUEST_ID));
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.code).toBe(code);
      for (const queryKey of EVERYTHING) {
        expect(invalidate).toHaveBeenCalledWith({ queryKey });
      }
    },
  );

  it('can be tapped again after it settles', async () => {
    arrivedMock
      .mockRejectedValueOnce(new RequestAppError('network'))
      .mockResolvedValueOnce(accepted);
    const { result } = await renderHook(() => useMarkArrived(), { wrapper });
    await act(async () => result.current.arrived(TABLE_REQUEST_ID));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => result.current.arrived(TABLE_REQUEST_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(arrivedMock).toHaveBeenCalledTimes(2);
  });
});
