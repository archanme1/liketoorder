import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RequestAppError, submitPickupRequest } from '../api';
import { requestKeys } from '../hooks/keys';
import { useSubmitPickupRequest, type SubmitInput } from '../hooks/useSubmitPickupRequest';

import { BUSINESS_ID, makeRequest } from '../__fixtures__/requests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  submitPickupRequest: jest.fn(),
}));

const submitMock = jest.mocked(submitPickupRequest);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const order: SubmitInput = {
  businessId: BUSINESS_ID,
  pickupAt: new Date('2026-11-08T18:00:00Z'),
  items: [{ itemId: 'i1', quantity: 2 }],
};

function keysSent(): string[] {
  return submitMock.mock.calls.map(([input]) => input.idempotencyKey);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  submitMock.mockReset();
});

afterEach(() => {
  client.clear();
  cleanup();
});

describe('useSubmitPickupRequest idempotency key', () => {
  it('re-uses the key when the same order is retried after a failure', async () => {
    submitMock
      .mockRejectedValueOnce(new RequestAppError('network'))
      .mockResolvedValueOnce(makeRequest());
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });

    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [first, second] = keysSent();
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('uses a new key when the order changed', async () => {
    submitMock.mockRejectedValue(new RequestAppError('network'));
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });

    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () =>
      result.current.submit({ ...order, items: [{ itemId: 'i1', quantity: 3 }] }),
    );
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(2));

    const [first, second] = keysSent();
    expect(second).not.toBe(first);
  });

  it('uses a new key for the next order after a success', async () => {
    submitMock.mockResolvedValue(makeRequest());
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });

    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => result.current.submit(order));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(2));

    const [first, second] = keysSent();
    expect(second).not.toBe(first);
  });

  it('sends one request when Submit is tapped twice while it runs', async () => {
    let finish: (value: ReturnType<typeof makeRequest>) => void = () => undefined;
    submitMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });

    await act(async () => {
      result.current.submit(order);
      result.current.submit(order);
    });
    expect(submitMock).toHaveBeenCalledTimes(1);

    await act(async () => finish(makeRequest()));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('allows a new attempt once the failed one has finished', async () => {
    submitMock.mockRejectedValueOnce(new RequestAppError('rate_limited'));
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });
    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isError).toBe(true));
    submitMock.mockResolvedValueOnce(makeRequest());
    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(submitMock).toHaveBeenCalledTimes(2);
  });
});

describe('useSubmitPickupRequest cache', () => {
  it('refetches the list and the detail after a success', async () => {
    submitMock.mockResolvedValue(makeRequest());
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });

    await act(async () => result.current.submit(order));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.mine });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: requestKeys.detail(makeRequest().id) });
  });
});
