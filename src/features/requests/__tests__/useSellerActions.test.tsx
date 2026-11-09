import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RequestAppError, markRequestOutcome, respondToRequest } from '../api';
import { requestKeys } from '../hooks/keys';
import { useMarkRequestOutcome } from '../hooks/useMarkRequestOutcome';
import { useRespondToRequest } from '../hooks/useRespondToRequest';

import { REQUEST_ID } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  respondToRequest: jest.fn(),
  markRequestOutcome: jest.fn(),
}));

const respondMock = jest.mocked(respondToRequest);
const outcomeMock = jest.mocked(markRequestOutcome);

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
  outcomeMock.mockReset();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

const ALL_THREE = [
  [...requestKeys.inboxAll],
  [...requestKeys.businessDetail(REQUEST_ID)],
  [...requestKeys.waitingCount],
];

describe('useRespondToRequest', () => {
  it('sends one decision for a double tap', async () => {
    const finish: ((r: ReturnType<typeof makeSellerRequest>) => void)[] = [];
    respondMock.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });

    try {
      await act(async () => {
        result.current.respond(REQUEST_ID, 'accepted');
        result.current.respond(REQUEST_ID, 'accepted');
        result.current.respond(REQUEST_ID, 'declined');
      });
      expect(respondMock).toHaveBeenCalledTimes(1);
      expect(respondMock).toHaveBeenCalledWith(REQUEST_ID, 'accepted');
    } finally {
      // Never leave a mutation pending, whatever the assertions said.
      await act(async () => finish.forEach((done) => done(makeSellerRequest())));
    }
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The guard opens again once settled.
    respondMock.mockResolvedValue(makeSellerRequest({ status: 'declined' }));
    await act(async () => result.current.respond(REQUEST_ID, 'declined'));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(2));
  });

  it('writes the answer into the detail and re-reads the inbox, the request and the count', async () => {
    client.setQueryData(requestKeys.businessDetail(REQUEST_ID), {
      server_now: '2026-11-08T17:00:00Z',
      request: makeSellerRequest(),
    });
    respondMock.mockResolvedValue(
      makeSellerRequest({ status: 'accepted', display_status: 'accepted' }),
    );
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () => result.current.respond(REQUEST_ID, 'accepted'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated).toEqual(expect.arrayContaining(ALL_THREE));
    const detail = client.getQueryData<{ request: { status: string } }>(
      requestKeys.businessDetail(REQUEST_ID),
    );
    expect(detail?.request.status).toBe('accepted');
  });

  it.each(['invalid_transition', 'not_found'] as const)(
    'also re-reads everything after %s, so the screen shows the real status',
    async (code) => {
      respondMock.mockRejectedValue(new RequestAppError(code));
      const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
      await act(async () => result.current.respond(REQUEST_ID, 'accepted'));
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.code).toBe(code);
      await waitFor(() => expect(invalidated).toEqual(expect.arrayContaining(ALL_THREE)));
    },
  );

  it('does not write anything into the detail when the call fails', async () => {
    const before = { server_now: '2026-11-08T17:00:00Z', request: makeSellerRequest() };
    client.setQueryData(requestKeys.businessDetail(REQUEST_ID), before);
    respondMock.mockRejectedValue(new RequestAppError('network'));
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () => result.current.respond(REQUEST_ID, 'accepted'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(requestKeys.businessDetail(REQUEST_ID))).toEqual(before);
  });

  it('sends only the id and the decision: no status, time or address', async () => {
    respondMock.mockResolvedValue(makeSellerRequest());
    const { result } = await renderHook(() => useRespondToRequest(), { wrapper });
    await act(async () => result.current.respond(REQUEST_ID, 'declined'));
    await waitFor(() => expect(respondMock).toHaveBeenCalled());
    expect(respondMock.mock.calls[0]).toEqual([REQUEST_ID, 'declined']);
  });
});

describe('useMarkRequestOutcome', () => {
  it('sends one outcome for a double tap', async () => {
    const finish: ((r: ReturnType<typeof makeSellerRequest>) => void)[] = [];
    outcomeMock.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const { result } = await renderHook(() => useMarkRequestOutcome(), { wrapper });
    try {
      await act(async () => {
        result.current.markOutcome(REQUEST_ID, 'completed');
        result.current.markOutcome(REQUEST_ID, 'no_show');
      });
      expect(outcomeMock).toHaveBeenCalledTimes(1);
      expect(outcomeMock).toHaveBeenCalledWith(REQUEST_ID, 'completed');
    } finally {
      await act(async () =>
        finish.forEach((done) => done(makeSellerRequest({ status: 'completed' }))),
      );
    }
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it.each(['invalid_transition', 'not_found'] as const)(
    're-reads everything after %s (the pickup time had not passed, or the request changed)',
    async (code) => {
      outcomeMock.mockRejectedValue(new RequestAppError(code));
      const { result } = await renderHook(() => useMarkRequestOutcome(), { wrapper });
      await act(async () => result.current.markOutcome(REQUEST_ID, 'no_show'));
      await waitFor(() => expect(result.current.isError).toBe(true));
      await waitFor(() => expect(invalidated).toEqual(expect.arrayContaining(ALL_THREE)));
    },
  );

  it('re-reads everything after a success', async () => {
    outcomeMock.mockResolvedValue(makeSellerRequest({ status: 'completed' }));
    const { result } = await renderHook(() => useMarkRequestOutcome(), { wrapper });
    await act(async () => result.current.markOutcome(REQUEST_ID, 'completed'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated).toEqual(expect.arrayContaining(ALL_THREE));
  });
});
