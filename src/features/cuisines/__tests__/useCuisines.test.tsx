import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { CuisineAppError, listCuisines } from '../api';
import { cuisinesKey, useCuisine, useCuisines } from '../hooks/useCuisines';
import type { Cuisine } from '../schema';

jest.mock('../api', () => {
  const actual = jest.requireActual('../api') as Record<string, unknown>;
  return { ...actual, listCuisines: jest.fn() };
});

const mockedList = listCuisines as unknown as jest.Mock;

const italy: Cuisine = {
  code: 'IT',
  kind: 'country',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 100,
};
const other: Cuisine = {
  code: 'other',
  kind: 'neutral',
  name: 'Other',
  flag: null,
  icon: 'ellipsis-horizontal-circle-outline',
  sort_order: 999,
};
const rows = [italy, other];

function makeClient() {
  return new QueryClient({
    // gcTime Infinity: no cache-cleanup timers left running after a test.
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue(rows);
});

describe('cuisinesKey', () => {
  it('equals ["cuisines"]', () => {
    expect([...cuisinesKey]).toEqual(['cuisines']);
  });
});

describe('useCuisines', () => {
  it('goes from loading to success with the list', async () => {
    const client = makeClient();
    const { result } = await renderHook(() => useCuisines(), { wrapper: wrapperFor(client) });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
  });

  it('exposes a CuisineAppError, and refetch recovers to success', async () => {
    mockedList.mockRejectedValueOnce(new CuisineAppError('network'));
    const client = makeClient();
    const { result } = await renderHook(() => useCuisines(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(CuisineAppError);
    expect(result.current.error?.code).toBe('network');

    await result.current.refetch();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it('does not refetch when unmounted and remounted with the same client (staleTime Infinity)', async () => {
    const client = makeClient();
    const first = await renderHook(() => useCuisines(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(mockedList).toHaveBeenCalledTimes(1);

    await first.unmount();

    const second = await renderHook(() => useCuisines(), { wrapper: wrapperFor(client) });
    expect(second.result.current.data).toEqual(rows);
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mockedList).toHaveBeenCalledTimes(1);
  });
});

describe('useCuisine', () => {
  it('returns Italy for "IT" from the same cache as useCuisines with one request', async () => {
    const client = makeClient();
    const { result } = await renderHook(() => ({ list: useCuisines(), one: useCuisine('IT') }), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.one.data).toEqual(italy));
    expect(result.current.list.data).toEqual(rows);
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('sends no second request when mounted after useCuisines has loaded', async () => {
    const client = makeClient();
    const list = await renderHook(() => useCuisines(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const one = await renderHook(() => useCuisine('IT'), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(one.result.current.data).toEqual(italy));
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('finds a neutral cuisine by its slug', async () => {
    const client = makeClient();
    const { result } = await renderHook(() => useCuisine('other'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toEqual(other));
  });

  it.each([
    ['an unknown code', 'XX'],
    ['null', null],
    ['undefined', undefined],
  ])('returns undefined for %s', async (_label, code) => {
    const client = makeClient();
    const { result } = await renderHook(() => useCuisine(code), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });
});
