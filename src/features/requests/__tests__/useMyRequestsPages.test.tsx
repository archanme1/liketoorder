import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { makeRows, pagedServer } from '../__fixtures__/pagedServer';
import { RequestAppError, listMyPickupRequests } from '../api';
import { requestKeys } from '../hooks/keys';
import { flattenPages, useMyRequests } from '../hooks/useMyRequests';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyPickupRequests: jest.fn(),
}));

const listMock = jest.mocked(listMyPickupRequests);
const server = { rows: makeRows(120) };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
// react-query only re-renders for props read during render; read everything.
const setup = () => renderHook(() => ({ ...useMyRequests() }), { wrapper });
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  server.rows = makeRows(120);
  listMock.mockReset();
  listMock.mockImplementation(pagedServer(server));
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

async function loadAll(result: { current: ReturnType<typeof useMyRequests> }) {
  await waitFor(() => expect(result.current.requests).toHaveLength(50));
  while (result.current.hasNextPage) {
    const before = result.current.requests.length;
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests.length).toBeGreaterThan(before));
  }
}

describe('paging', () => {
  it("loads 50, then the next 50 from the last row's created_at, exactly as the server wrote it", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(listMock).toHaveBeenLastCalledWith(undefined);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    // The microseconds are kept: the cursor is the server's text, not a parsed Date.
    expect(listMock).toHaveBeenLastCalledWith(server.rows[49].created_at);
    expect(listMock.mock.calls.at(-1)?.[0]).toMatch(/\.123456\+00:00$/);
  });

  it('shows every request once and in order, across all pages', async () => {
    const { result } = await setup();
    await loadAll(result);
    expect(result.current.requests).toHaveLength(120);
    expect(new Set(ids(result.current.requests)).size).toBe(120);
    expect(ids(result.current.requests)).toEqual(ids(server.rows));
  });

  it('stops after a short page, and does not ask again', async () => {
    const { result } = await setup();
    await loadAll(result);
    expect(result.current.hasNextPage).toBe(false);
    const calls = listMock.mock.calls.length;
    expect(calls).toBe(3);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(listMock.mock.calls.length).toBe(calls);
  });

  it('exactly 50 requests: one more (empty) read ends the list', async () => {
    server.rows = makeRows(50);
    const { result } = await setup();
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.requests).toHaveLength(50);
  });

  it('flattenPages keeps the first copy of a repeated request', () => {
    const rows = makeRows(3);
    const data = {
      pages: [
        { server_now: 'x', requests: rows.slice(0, 2) },
        { server_now: 'x', requests: rows.slice(1, 3) },
      ],
      pageParams: [{}, { before: 'x' }],
    };
    expect(ids(flattenPages(data))).toEqual(ids(rows));
    expect(flattenPages(undefined)).toEqual([]);
  });
});

describe('refetching loaded pages', () => {
  it('a request added meanwhile loses and repeats no row (cursors come from the fresh pages)', async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));

    const [newest] = makeRows(1);
    server.rows = [
      {
        ...newest,
        id: '99999999-0000-4000-8000-000000000001',
        created_at: '2026-11-08T17:05:00.000001+00:00',
      },
      ...server.rows,
    ];
    await act(async () => {
      await result.current.refetch();
    });
    // Two pages are still loaded (100 rows): the new one is first, and the old 100th has moved to
    // the unloaded third page. No row in the first 100 is missing or repeated.
    await waitFor(() => expect(result.current.requests[0].id).toBe(server.rows[0].id));
    expect(result.current.requests).toHaveLength(100);
    expect(ids(result.current.requests)).toEqual(ids(server.rows.slice(0, 100)));
    expect(result.current.hasNextPage).toBe(true);
  });

  it('a request removed meanwhile (a business deleted) leaves no duplicate or gap', async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    server.rows = server.rows.filter((_, i) => i !== 10);
    await act(async () => {
      await result.current.refetch();
    });
    // The length stays 100 either way, so wait for the rows themselves to change.
    await waitFor(() =>
      expect(ids(result.current.requests)).toEqual(ids(server.rows.slice(0, 100))),
    );
    expect(new Set(ids(result.current.requests)).size).toBe(100);
  });

  it("a status change on page 2 shows after a refetch (app focus), and after a cancel's invalidation", async () => {
    server.rows = makeRows(120, 'pending');
    const { result } = await setup();
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    const target = server.rows[70].id;
    const status = () => result.current.requests.find((r) => r.id === target)?.display_status;
    expect(status()).toBe('pending');

    server.rows = server.rows.map((row) =>
      row.id === target ? { ...row, status: 'cancelled', display_status: 'cancelled' } : row,
    );
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(status()).toBe('cancelled'));

    // The cancel mutation invalidates this key; it re-reads every loaded page too.
    server.rows = server.rows.map((row) =>
      row.id === server.rows[80].id
        ? { ...row, status: 'expired', display_status: 'expired' }
        : row,
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: requestKeys.mine });
    });
    await waitFor(() =>
      expect(result.current.requests.find((r) => r.id === server.rows[80].id)?.display_status).toBe(
        'expired',
      ),
    );
    expect(result.current.requests).toHaveLength(100);
  });
});

describe('refresh (pull to refresh)', () => {
  it('goes back to the newest 50 and reads one page', async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    listMock.mockClear();

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith(undefined);
    expect(result.current.hasNextPage).toBe(true);
  });
});

describe('failures', () => {
  it('a failed next page keeps the loaded rows and can be retried', async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.requests).toHaveLength(50);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    expect(result.current.isFetchNextPageError).toBe(false);
  });
});
