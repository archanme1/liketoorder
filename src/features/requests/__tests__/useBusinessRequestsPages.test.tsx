import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { makeSellerRows, sellerPagedServer, sortSellerRows } from '../__fixtures__/sellerRequests';
import { RequestAppError, listBusinessRequests } from '../api';
import { flattenBusinessPages, useBusinessRequests } from '../hooks/useBusinessRequests';
import { PENDING_POLL_MS } from '../hooks/keys';
import type { RequestFilter } from '../schema';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listBusinessRequests: jest.fn(),
}));

const listMock = jest.mocked(listBusinessRequests);
const TIE = '2026-11-08T16:00:00.654321+00:00';
const server = { rows: makeSellerRows(120) };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
// react-query only re-renders for props read during render; read everything.
const setup = (filter: RequestFilter = 'all') =>
  renderHook(({ f }: { f: RequestFilter }) => ({ ...useBusinessRequests(f) }), {
    wrapper,
    initialProps: { f: filter },
  });
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const sorted = () => sortSellerRows(server.rows);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  server.rows = makeSellerRows(120);
  listMock.mockReset();
  listMock.mockImplementation(sellerPagedServer(server));
});

afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
  client.clear();
});

async function loadAll(result: { current: ReturnType<typeof useBusinessRequests> }) {
  await waitFor(() => expect(result.current.requests.length).toBeGreaterThan(0));
  while (result.current.hasNextPage) {
    const before = result.current.requests.length;
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests.length).toBeGreaterThan(before));
  }
}

describe('paging by the server cursor', () => {
  it('loads 50, then asks for the next page with the cursor exactly as the server wrote it', async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(listMock).toHaveBeenLastCalledWith('all', undefined);
    const cursor = result.current.data?.pages[0].next_cursor;
    expect(cursor).toMatch(/\.123456Z\|00000000-0000-4000-8000-0000000000\d\d$/);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    expect(listMock.mock.calls.at(-1)?.[1]).toBe(cursor);
  });

  it('shows every request once and in the server order', async () => {
    const { result } = await setup();
    await loadAll(result);
    expect(result.current.requests).toHaveLength(120);
    expect(ids(result.current.requests)).toEqual(ids(sorted()));
  });

  it('exactly 100 requests: the second page is the last and no empty page is read', async () => {
    server.rows = makeSellerRows(100);
    const { result } = await setup();
    await loadAll(result);
    expect(result.current.requests).toHaveLength(100);
    expect(result.current.hasNextPage).toBe(false);
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('120 rows sharing one created_at: none skipped, none repeated across page boundaries', async () => {
    server.rows = makeSellerRows(120, { sharedCreatedAt: TIE });
    const { result } = await setup();
    await loadAll(result);
    expect(result.current.requests).toHaveLength(120);
    expect(new Set(ids(result.current.requests)).size).toBe(120);
    expect(ids(result.current.requests)).toEqual(ids(sorted()));
  });

  it('flattenBusinessPages keeps the first copy of a repeated request, in page order', () => {
    const rows = makeSellerRows(3);
    const page = (requests: typeof rows) => ({
      server_now: '2026-11-08T17:00:00Z',
      requests,
      next_cursor: null,
    });
    const data = {
      pages: [page(rows.slice(0, 2)), page(rows.slice(1, 3))],
      pageParams: [{}, { before: 'x' }],
    };
    expect(ids(flattenBusinessPages(data))).toEqual(ids(rows));
    expect(flattenBusinessPages(undefined)).toEqual([]);
  });
});

describe('filters', () => {
  it('Pending asks the server for pending and keeps its own cache apart from All', async () => {
    server.rows = [
      ...makeSellerRows(2, { status: 'pending' }),
      ...makeSellerRows(3, { status: 'declined' }).map((r, i) => ({
        ...r,
        id: `00000000-0000-4000-8000-0000000001${i}0`,
      })),
    ];
    const { result, rerender } = await setup('pending');
    await waitFor(() => expect(result.current.requests).toHaveLength(2));
    expect(listMock).toHaveBeenLastCalledWith('pending', undefined);

    await rerender({ f: 'all' });
    await waitFor(() => expect(result.current.requests).toHaveLength(5));
    expect(listMock).toHaveBeenLastCalledWith('all', undefined);

    await rerender({ f: 'pending' });
    await waitFor(() => expect(result.current.requests).toHaveLength(2));
    expect(ids(result.current.requests).every((id) => id.endsWith('1') || id.endsWith('2'))).toBe(
      true,
    );
  });
});

describe('refetching and polling', () => {
  it('a status change on page 2 shows after an app-focus refetch', async () => {
    server.rows = makeSellerRows(120, { status: 'pending' });
    const { result } = await setup();
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(100));
    const target = sorted()[70].id;
    const status = () => result.current.requests.find((r) => r.id === target)?.display_status;

    server.rows = server.rows.map((row) =>
      row.id === target ? { ...row, status: 'cancelled', display_status: 'cancelled' } : row,
    );
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(status()).toBe('cancelled'));
    expect(result.current.requests).toHaveLength(100);
  });

  it('polls every 30 s while a pending row is loaded, and not otherwise', async () => {
    jest.useFakeTimers();
    server.rows = makeSellerRows(2, { status: 'pending' });
    const { result } = await setup();
    await waitFor(() => expect(result.current.requests).toHaveLength(2));
    listMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    // Everything answered: the next poll finds no pending row, and polling stops.
    server.rows = server.rows.map((r) => ({
      ...r,
      status: 'declined',
      display_status: 'declined',
    }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS);
    });
    await waitFor(() => expect(result.current.requests[0].display_status).toBe('declined'));
    listMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS * 3);
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('does not poll a list with nothing pending', async () => {
    jest.useFakeTimers();
    server.rows = makeSellerRows(3, { status: 'declined' });
    const { result } = await setup();
    await waitFor(() => expect(result.current.requests).toHaveLength(3));
    listMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS * 3);
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('an EMPTY Pending list is still polled, so a new request shows up after 30 s', async () => {
    jest.useFakeTimers();
    server.rows = makeSellerRows(3, { status: 'declined' });
    const { result } = await setup('pending');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.requests).toHaveLength(0);

    server.rows = [
      ...server.rows,
      { ...makeSellerRows(1)[0], id: '00000000-0000-4000-8000-0000000000ff', customer_name: 'New' },
    ];
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    expect(result.current.requests[0].customer_name).toBe('New');
  });

  it("re-reads just after a pending row's expires_at on the server's clock", async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T17:00:00Z') });
    // The server says it is 17:00 and the row expires at 17:00:20.
    server.rows = [
      {
        ...makeSellerRows(1, { status: 'pending' })[0],
        expires_at: '2026-11-08T17:00:20+00:00',
      },
    ];
    const { result } = await setup('pending');
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    listMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(19_000);
    });
    expect(listMock).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

describe('refresh (pull to refresh)', () => {
  async function loadTwoPages() {
    const view = await setup();
    await act(async () => {
      await view.result.current.fetchNextPage();
    });
    await waitFor(() => expect(view.result.current.requests).toHaveLength(100));
    return view;
  }

  it('goes back to the newest 50 of the current filter and reads one page', async () => {
    const { result } = await loadTwoPages();
    listMock.mockClear();
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith('all', undefined);
    expect(result.current.hasNextPage).toBe(true);
  });

  it('a failed refresh keeps every loaded page, and says so', async () => {
    const { result } = await loadTwoPages();
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.refreshFailed).toBe(true);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.requests).toHaveLength(100);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.refreshFailed).toBe(false);
    await waitFor(() => expect(result.current.requests).toHaveLength(50));
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

  it('a first load that fails is an error with no data', async () => {
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.code).toBe('network');
  });
});
