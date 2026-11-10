import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RequestAppError, submitTableRequest } from '../api';
import { requestKeys } from '../hooks/keys';
import { useSubmitTableRequest, type SubmitTableArgs } from '../hooks/useSubmitTableRequest';

import { BUSINESS_ID } from '../__fixtures__/requests';
import { makeTableRequest } from '../__fixtures__/tableRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  submitTableRequest: jest.fn(),
}));

const submitMock = jest.mocked(submitTableRequest);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const request: SubmitTableArgs = {
  businessId: BUSINESS_ID,
  tableAt: new Date('2026-11-09T00:00:00Z'),
  partySize: 4,
};
const keysSent = () => submitMock.mock.calls.map(([input]) => input.idempotencyKey);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  submitMock.mockReset();
});

afterEach(async () => {
  client.clear();
  await cleanup();
});

describe('useSubmitTableRequest', () => {
  it('re-uses the key when the same request is retried after a failure', async () => {
    submitMock
      .mockRejectedValueOnce(new RequestAppError('network'))
      .mockResolvedValueOnce(makeTableRequest());
    const { result } = await renderHook(() => useSubmitTableRequest(), { wrapper });

    await act(async () => result.current.submit(request));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => result.current.submit(request));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [first, second] = keysSent();
    // A real uuid (expo-crypto randomUUID), and the same one again.
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(second).toBe(first);
  });

  it('uses a new key when the party or the time changed', async () => {
    submitMock.mockRejectedValue(new RequestAppError('network'));
    const { result } = await renderHook(() => useSubmitTableRequest(), { wrapper });

    await act(async () => result.current.submit(request));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => result.current.submit({ ...request, partySize: 5 }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(2));

    const [first, second] = keysSent();
    expect(second).not.toBe(first);
  });

  it('sends one request on a double tap', async () => {
    let finish: (value: ReturnType<typeof makeTableRequest>) => void = () => undefined;
    submitMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = await renderHook(() => useSubmitTableRequest(), { wrapper });

    await act(async () => {
      result.current.submit(request);
      result.current.submit(request);
    });
    expect(submitMock).toHaveBeenCalledTimes(1);
    await act(async () => finish(makeTableRequest()));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('re-reads Sent and the detail after a success, and uses a new key for the next one', async () => {
    submitMock.mockResolvedValue(makeTableRequest());
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useSubmitTableRequest(), { wrapper });

    await act(async () => result.current.submit(request));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.mine });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: requestKeys.detail(makeTableRequest().id),
    });

    await act(async () => result.current.submit(request));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(2));
    const [first, second] = keysSent();
    expect(second).not.toBe(first);
  });
});
