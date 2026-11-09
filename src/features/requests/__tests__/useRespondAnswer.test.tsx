import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RequestAppError, respondToRequest } from '../api';
import { requestKeys } from '../hooks/keys';
import { useRespondToRequest } from '../hooks/useRespondToRequest';
import type { WaitingCount } from '../schema';

import { REQUEST_ID } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  respondToRequest: jest.fn(),
}));

const respondMock = jest.mocked(respondToRequest);

let client: QueryClient;
let invalidated: unknown[][];
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  invalidated = [];
  const original = client.invalidateQueries.bind(client);
  jest.spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push([...(filters?.queryKey ?? [])]);
    return original(filters);
  });
  respondMock.mockReset();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('useRespondToRequest with an answer (spec 10b)', () => {
  it('passes the reason and the note on, and a plain accept stays a two-argument call', async () => {
    respondMock.mockResolvedValue(makeSellerRequest({ status: 'declined' }));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () =>
      result.current.respond(REQUEST_ID, 'declined', { declineReason: 'other', note: 'Oven broke' }),
    );
    expect(respondMock.mock.calls[0]).toEqual([
      REQUEST_ID,
      'declined',
      { declineReason: 'other', note: 'Oven broke' },
    ]);

    respondMock.mockClear();
    await act(async () => result.current.respond(REQUEST_ID, 'accepted'));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock.mock.calls[0]).toEqual([REQUEST_ID, 'accepted']);
  });

  it('sends one decision for a double tap that carries an answer', async () => {
    const finish: ((r: ReturnType<typeof makeSellerRequest>) => void)[] = [];
    respondMock.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    try {
      await act(async () => {
        result.current.respond(REQUEST_ID, 'declined', { declineReason: 'sold_out' });
        result.current.respond(REQUEST_ID, 'declined', { declineReason: 'sold_out' });
      });
      expect(respondMock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => finish.forEach((resolve) => resolve(makeSellerRequest())));
    }
  });

  it('re-reads the customer list too, and lowers the waiting count at once', async () => {
    client.setQueryData<WaitingCount>(requestKeys.waitingCount, {
      server_now: '2026-11-08T17:00:00Z',
      waiting: 3,
    });
    respondMock.mockResolvedValue(makeSellerRequest({ status: 'accepted' }));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () => result.current.respond(REQUEST_ID, 'accepted'));
    await waitFor(() => expect(invalidated).toContainEqual([...requestKeys.mine]));
    expect(invalidated).toEqual(
      expect.arrayContaining([
        [...requestKeys.inboxAll],
        [...requestKeys.businessDetail(REQUEST_ID)],
        [...requestKeys.waitingCount],
      ]),
    );
    expect(client.getQueryData<WaitingCount>(requestKeys.waitingCount)?.waiting).toBe(2);
  });

  it('never takes the waiting count below zero', async () => {
    client.setQueryData<WaitingCount>(requestKeys.waitingCount, {
      server_now: '2026-11-08T17:00:00Z',
      waiting: 0,
    });
    respondMock.mockResolvedValue(makeSellerRequest({ status: 'accepted' }));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () => result.current.respond(REQUEST_ID, 'accepted'));
    expect(client.getQueryData<WaitingCount>(requestKeys.waitingCount)?.waiting).toBe(0);
  });

  it('reports a validation error with its code and lets the caller try again', async () => {
    respondMock.mockRejectedValueOnce(new RequestAppError('decline_reason_required'));
    respondMock.mockResolvedValueOnce(makeSellerRequest({ status: 'declined' }));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () => result.current.respond(REQUEST_ID, 'declined', { declineReason: 'sold_out' }));
    await waitFor(() => expect(result.current.error?.code).toBe('decline_reason_required'));
    await act(async () => result.current.respond(REQUEST_ID, 'declined', { declineReason: 'sold_out' }));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(2));
  });
});
