import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  claimFoodLogCleanup,
  deleteFoodLog,
  FoodLogAppError,
  getFoodLog,
  listMyFoodLogs,
  updateFoodLog,
} from '../api';
import { useFoodLog } from '../hooks/useFoodLog';
import { useCreateFoodLog, useDeleteFoodLog, useUpdateFoodLog } from '../hooks/useFoodLogMutations';
import { useMyFoodLogs } from '../hooks/useMyFoodLogs';
import type { FoodLog } from '../schema';
import { uploadFoodLog } from '../uploadFoodLog';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getFoodLog: jest.fn(),
  listMyFoodLogs: jest.fn(),
  updateFoodLog: jest.fn(),
  deleteFoodLog: jest.fn(),
  claimFoodLogCleanup: jest.fn(),
}));
jest.mock('../uploadFoodLog', () => ({
  ...jest.requireActual('../uploadFoodLog'),
  uploadFoodLog: jest.fn(),
}));

const mockedGet = jest.mocked(getFoodLog);
const mockedList = jest.mocked(listMyFoodLogs);
const mockedUpdate = jest.mocked(updateFoodLog);
const mockedDelete = jest.mocked(deleteFoodLog);
const mockedClaim = jest.mocked(claimFoodLogCleanup);
const mockedUpload = jest.mocked(uploadFoodLog);

function log(n: number, overrides: Partial<FoodLog> = {}): FoodLog {
  return {
    id: `log-${n}`,
    cuisine_code: 'IT',
    description: `Meal ${n}`,
    is_public: true,
    local_date: '2026-11-14',
    created_at: '2026-11-14T12:00:00+00:00',
    path: `u1/log-${n}.jpg`,
    is_mine: true,
    ...overrides,
  };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  mockedClaim.mockResolvedValue([]);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
});

describe('useMyFoodLogs', () => {
  it('pages on next_cursor, sends it back untouched and keeps each log once', async () => {
    mockedList
      .mockResolvedValueOnce({ items: [log(1), log(2)], next_cursor: 'c-1' })
      .mockResolvedValueOnce({ items: [log(2), log(3)], next_cursor: null });
    const { result } = await renderHook(() => useMyFoodLogs(), { wrapper });

    await waitFor(() => expect(result.current.logs.map((l) => l.id)).toEqual(['log-1', 'log-2']));
    expect(mockedList).toHaveBeenLastCalledWith(null);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mockedList).toHaveBeenLastCalledWith('c-1');
    await waitFor(() =>
      expect(result.current.logs.map((l) => l.id)).toEqual(['log-1', 'log-2', 'log-3']),
    );
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useFoodLog', () => {
  it('returns my own log', async () => {
    mockedGet.mockResolvedValue(log(1));
    const { result } = await renderHook(() => useFoodLog('log-1'), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('log-1'));
  });

  it.each([
    ['someone else public log (path null)', log(1, { is_mine: false, path: null })],
    ['a log that is not mine', log(1, { is_mine: false })],
    ['a log of mine without a path', log(1, { path: null })],
  ])('treats %s as not_found', async (_name, value) => {
    mockedGet.mockResolvedValue(value);
    const { result } = await renderHook(() => useFoodLog('log-1'), { wrapper });
    await waitFor(() => expect(result.current.error).toEqual(new FoodLogAppError('not_found')));
    expect(result.current.data).toBeUndefined();
  });
});

describe('the mutations invalidate the list and the detail', () => {
  async function renderWithList(id: string, useMutation: () => unknown) {
    mockedList.mockResolvedValue({ items: [log(1)], next_cursor: null });
    mockedGet.mockResolvedValue(log(1));
    const rendered = await renderHook(
      () => ({ list: useMyFoodLogs(), detail: useFoodLog(id), mutation: useMutation() }),
      { wrapper },
    );
    await waitFor(() => expect(rendered.result.current.detail.data?.id).toBe(id));
    await waitFor(() => expect(rendered.result.current.list.logs).toHaveLength(1));
    mockedList.mockClear();
    mockedGet.mockClear();
    return rendered;
  }

  it('create refetches the list and the new log', async () => {
    mockedUpload.mockResolvedValue(log(1));
    const { result } = await renderWithList('log-1', () => useCreateFoodLog());
    const mutation = result.current.mutation as ReturnType<typeof useCreateFoodLog>;
    await act(async () => {
      await mutation.mutateAsync({
        sourceUri: 'file:///p.jpg',
        cuisineCode: 'IT',
        description: null,
        isPublic: true,
      });
    });
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('log-1'));
  });

  it('update stores the returned log and refetches the list and the detail', async () => {
    mockedUpdate.mockResolvedValue(log(1, { description: 'Changed' }));
    const { result } = await renderWithList('log-1', () => useUpdateFoodLog('log-1'));
    const mutation = result.current.mutation as ReturnType<typeof useUpdateFoodLog>;
    await act(async () => {
      await mutation.mutateAsync({ cuisineCode: 'IT', description: 'Changed', isPublic: true });
    });
    expect(mockedUpdate).toHaveBeenCalledWith('log-1', {
      cuisineCode: 'IT',
      description: 'Changed',
      isPublic: true,
    });
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('log-1'));
  });

  it('delete refetches the list, marks the detail stale without refetching it, and cleans up', async () => {
    mockedDelete.mockResolvedValue();
    const { result } = await renderWithList('log-1', () => useDeleteFoodLog('log-1'));
    const mutation = result.current.mutation as ReturnType<typeof useDeleteFoodLog>;
    await act(async () => {
      await mutation.mutateAsync();
    });
    expect(mockedDelete).toHaveBeenCalledWith('log-1');
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    expect(client.getQueryState(['food-log', 'log-1'])?.isInvalidated).toBe(true);
    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.current.detail.error).toBeNull();
    await waitFor(() => expect(mockedClaim).toHaveBeenCalled());
  });
});
