import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchRestaurantDetails, MapAppError } from '../api';
import { useRestaurantDetails } from '../hooks/useRestaurantDetails';
import type { RestaurantDetails } from '../schema';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  fetchRestaurantDetails: jest.fn(),
}));

const fetchDetails = jest.mocked(fetchRestaurantDetails);

const details: RestaurantDetails = {
  id: 'b1',
  name: "Joe's",
  cuisine_code: 'IT',
  accepts_table_requests: false,
  public_address: '1 King St',
  place_id: 'FAKE_PLACE_1',
  currency_code: 'CAD',
  photos: [],
  items: [],
};

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function setup(id: string | null) {
  return renderHook((props: { id: string | null }) => useRestaurantDetails(props.id), {
    wrapper,
    initialProps: { id },
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  fetchDetails.mockReset();
});

describe('useRestaurantDetails', () => {
  it('sends nothing without an id', async () => {
    const { result } = await setup(null);
    await act(async () => undefined);
    expect(fetchDetails).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('loads the details for the id', async () => {
    fetchDetails.mockResolvedValue(details);
    const { result } = await setup('b1');
    await waitFor(() => expect(result.current.data).toEqual(details));
    expect(fetchDetails).toHaveBeenCalledWith('b1');
  });

  it('treats null as a normal "not available" answer, not an error', async () => {
    fetchDetails.mockResolvedValue(null);
    const { result } = await setup('b1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('caches for 5 minutes: opening the same restaurant again asks nothing', async () => {
    fetchDetails.mockResolvedValue(details);
    const first = await setup('b1');
    await waitFor(() => expect(first.result.current.data).toEqual(details));
    await first.unmount();
    const second = await setup('b1');
    await waitFor(() => expect(second.result.current.data).toEqual(details));
    expect(fetchDetails).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different restaurant', async () => {
    fetchDetails.mockResolvedValue(details);
    const { result, rerender } = await setup('b1');
    await waitFor(() => expect(result.current.data).toEqual(details));
    await rerender({ id: 'b2' });
    await waitFor(() => expect(fetchDetails).toHaveBeenCalledWith('b2'));
  });

  it('never retries rate_limited, and does not re-send it on focus', async () => {
    fetchDetails.mockRejectedValue(new MapAppError('rate_limited'));
    const { result } = await setup('b1');
    await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1300)));
    expect(fetchDetails).toHaveBeenCalledTimes(1);
  });

  it('retries another error at most once', async () => {
    fetchDetails.mockRejectedValue(new MapAppError('network'));
    const { result } = await setup('b1');
    await waitFor(() => expect(result.current.error?.code).toBe('network'), { timeout: 4000 });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1300)));
    expect(fetchDetails).toHaveBeenCalledTimes(2);
  });

  it('loads again only when the person asks (refetch)', async () => {
    fetchDetails
      .mockRejectedValueOnce(new MapAppError('rate_limited'))
      .mockResolvedValueOnce(details);
    const { result } = await setup('b1');
    await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toEqual(details));
    expect(fetchDetails).toHaveBeenCalledTimes(2);
  });
});
