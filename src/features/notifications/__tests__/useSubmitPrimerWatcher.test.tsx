import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { RequestAppError, submitPickupRequest, submitTableRequest } from '@/features/requests/api';
import { useSubmitPickupRequest } from '@/features/requests/hooks/useSubmitPickupRequest';
import { useSubmitTableRequest } from '@/features/requests/hooks/useSubmitTableRequest';

import { useSubmitPrimerWatcher } from '../hooks/useSubmitPrimerWatcher';
import { getPendingPrimer, resetPrimerMomentForTests } from '../primerMoment';

jest.mock('@/features/requests/api', () => ({
  ...jest.requireActual('@/features/requests/api'),
  submitPickupRequest: jest.fn(),
  submitTableRequest: jest.fn(),
}));

const pickupMock = jest.mocked(submitPickupRequest);
const tableMock = jest.mocked(submitTableRequest);
const BUSINESS_ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  resetPrimerMomentForTests();
  jest.clearAllMocks();
});

describe('useSubmitPrimerWatcher', () => {
  it('a sent pickup request is a primer moment (customer)', async () => {
    pickupMock.mockResolvedValueOnce({ id: 'r1' } as Awaited<
      ReturnType<typeof submitPickupRequest>
    >);
    const { result } = await renderHook(
      () => {
        useSubmitPrimerWatcher();
        return useSubmitPickupRequest();
      },
      { wrapper },
    );
    await act(async () => {
      result.current.submit({ businessId: BUSINESS_ID, pickupAt: new Date(), orderText: 'soup' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getPendingPrimer()).toBe('customer');
  });

  it('a sent table request is a primer moment too', async () => {
    tableMock.mockResolvedValueOnce({ id: 't1' } as Awaited<ReturnType<typeof submitTableRequest>>);
    const { result } = await renderHook(
      () => {
        useSubmitPrimerWatcher();
        return useSubmitTableRequest();
      },
      { wrapper },
    );
    await act(async () => {
      result.current.submit({ businessId: BUSINESS_ID, tableAt: new Date(), partySize: 2 });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getPendingPrimer()).toBe('customer');
  });

  it('a refused request is not', async () => {
    pickupMock.mockRejectedValueOnce(new RequestAppError('too_many_pending'));
    const { result } = await renderHook(
      () => {
        useSubmitPrimerWatcher();
        return useSubmitPickupRequest();
      },
      { wrapper },
    );
    await act(async () => {
      result.current.submit({ businessId: BUSINESS_ID, pickupAt: new Date(), orderText: 'soup' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getPendingPrimer()).toBeNull();
  });

  it('any other successful mutation is not', async () => {
    const { result } = await renderHook(
      () => {
        useSubmitPrimerWatcher();
        return useMutation({ mutationKey: ['requests', 'cancel'], mutationFn: async () => 'ok' });
      },
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(getPendingPrimer()).toBeNull();
  });

  it('stops watching when unmounted', async () => {
    pickupMock.mockResolvedValueOnce({ id: 'r1' } as Awaited<
      ReturnType<typeof submitPickupRequest>
    >);
    const watcher = await renderHook(() => useSubmitPrimerWatcher(), { wrapper });
    await watcher.unmount();
    const { result } = await renderHook(() => useSubmitPickupRequest(), { wrapper });
    await act(async () => {
      result.current.submit({ businessId: BUSINESS_ID, pickupAt: new Date(), orderText: 'soup' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getPendingPrimer()).toBeNull();
  });
});
