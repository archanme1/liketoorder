import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { makeMixedRows, pagedServer } from '../__fixtures__/pagedServer';
import {
  makeMixedSellerRows,
  makeSellerRows,
  sellerPagedServer,
  sortSellerRows,
} from '../__fixtures__/sellerRequests';
import { makeSellerTableRequest } from '../__fixtures__/tableRequests';
import { listBusinessRequests, listMyRequests } from '../api';
import { useBusinessRequests } from '../hooks/useBusinessRequests';
import { useMyRequests } from '../hooks/useMyRequests';
import type { BusinessRequest, CustomerRequest } from '../schema';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  listBusinessRequests: jest.fn(),
}));

const myMock = jest.mocked(listMyRequests);
const inboxMock = jest.mocked(listBusinessRequests);
const mine = { rows: [] as CustomerRequest[] };
const inbox = { rows: [] as BusinessRequest[] };
const TIE = '2026-11-08T16:00:00.654321+00:00';

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const kinds = (rows: { kind: string }[]) => new Set(rows.map((row) => row.kind));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  myMock.mockReset();
  inboxMock.mockReset();
  myMock.mockImplementation(pagedServer(mine));
  inboxMock.mockImplementation(sellerPagedServer(inbox));
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

async function loadAll<T extends { requests: unknown[]; hasNextPage: boolean }>(result: {
  current: T;
}) {
  await waitFor(() => expect(result.current.requests).toHaveLength(50));
  while (result.current.hasNextPage) {
    const before = result.current.requests.length;
    await act(async () => {
      await (
        result.current as unknown as { fetchNextPage: () => Promise<unknown> }
      ).fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests.length).toBeGreaterThan(before));
  }
}

describe('Sent: pickup and table rows on one list', () => {
  it('50 a page, newest first, every row once, both kinds', async () => {
    mine.rows = makeMixedRows(120);
    const { result } = await renderHook(() => ({ ...useMyRequests() }), { wrapper });
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(kinds(result.current.requests)).toEqual(new Set(['pickup', 'table']));
    await loadAll(result);
    expect(result.current.requests).toHaveLength(120);
    expect(new Set(ids(result.current.requests)).size).toBe(120);
    expect(ids(result.current.requests)).toEqual(ids(mine.rows));
    expect(myMock).toHaveBeenCalledTimes(3);
  });

  it('exactly 100 rows: two pages and no empty third read', async () => {
    mine.rows = makeMixedRows(100);
    const { result } = await renderHook(() => ({ ...useMyRequests() }), { wrapper });
    await loadAll(result);
    expect(result.current.requests).toHaveLength(100);
    expect(myMock).toHaveBeenCalledTimes(2);
  });
});

describe('Received: pickup and table rows on one list', () => {
  it('50 a page in the server order, every row once, both kinds', async () => {
    inbox.rows = makeMixedSellerRows(120);
    const { result } = await renderHook(() => ({ ...useBusinessRequests('all') }), { wrapper });
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(kinds(result.current.requests)).toEqual(new Set(['pickup', 'table']));
    await loadAll(result);
    expect(result.current.requests).toHaveLength(120);
    expect(ids(result.current.requests)).toEqual(ids(sortSellerRows(inbox.rows)));
  });

  it('120 rows sharing one timestamp, mixed kinds on the tie: no skip, no repeat', async () => {
    inbox.rows = makeSellerRows(120, { sharedCreatedAt: TIE }).map((row, i) =>
      i % 2 === 0
        ? makeSellerTableRequest({
            id: row.id,
            customer_name: row.customer_name,
            created_at: TIE,
            status: row.status,
            display_status: row.display_status,
          })
        : row,
    );
    const { result } = await renderHook(() => ({ ...useBusinessRequests('all') }), { wrapper });
    await loadAll(result);
    expect(result.current.requests).toHaveLength(120);
    expect(new Set(ids(result.current.requests)).size).toBe(120);
    expect(ids(result.current.requests)).toEqual(ids(sortSellerRows(inbox.rows)));
    expect(kinds(result.current.requests)).toEqual(new Set(['pickup', 'table']));
  });

  it('exactly 100 rows: two pages and no empty third read', async () => {
    inbox.rows = makeMixedSellerRows(100);
    const { result } = await renderHook(() => ({ ...useBusinessRequests('all') }), { wrapper });
    await loadAll(result);
    expect(result.current.requests).toHaveLength(100);
    expect(inboxMock).toHaveBeenCalledTimes(2);
  });
});
