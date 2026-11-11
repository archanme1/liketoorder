import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  makeSellerRequest,
  makeSellerRows,
  sellerPagedServer,
} from '../__fixtures__/sellerRequests';
import { RequestAppError, listBusinessRequests } from '../api';
import { PENDING_POLL_MS } from '../hooks/keys';
import { SellerRequestsScreen } from '../components/SellerRequestsScreen';
import type { SellerRequest } from '../schema';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listBusinessRequests: jest.fn(),
}));

const listMock = jest.mocked(listBusinessRequests);
const server: { rows: SellerRequest[] } = { rows: [] };
let client: QueryClient;

function renderScreen(onOpen = jest.fn()) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SellerRequestsScreen onOpen={onOpen} timeZone="America/Toronto" locale="en-CA" />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

const endReached = () => act(async () => fireEvent(screen.getByTestId('inbox-list'), 'endReached'));
const pull = () =>
  act(async () => {
    screen.getByTestId('inbox-list').props.refreshControl.props.onRefresh();
  });

/** Two waiting requests and three answered ones, named so they are easy to find. */
function mixedRows(): SellerRequest[] {
  const base = makeSellerRows(5);
  const statuses = ['pending', 'declined', 'pending', 'accepted', 'cancelled'] as const;
  return base.map((row, i) => ({
    ...row,
    customer_name: ['Ana', 'Ben', 'Cy', 'Di', 'Ed'][i],
    status: statuses[i],
    display_status: statuses[i],
  }));
}

beforeEach(() => {
  server.rows = mixedRows();
  listMock.mockReset();
  listMock.mockImplementation(sellerPagedServer(server));
});

afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
  client.clear();
});

describe('the filter', () => {
  it('opens on Pending: asks the server for pending and shows only those', async () => {
    await renderScreen();
    expect(await screen.findByText('Ana')).toBeOnTheScreen();
    expect(listMock).toHaveBeenCalledWith('pending', undefined);
    expect(screen.getByText('Cy')).toBeOnTheScreen();
    expect(screen.queryByText('Ben')).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Pending, selected' })).toBeOnTheScreen();
  });

  it('All shows every request and says All is selected', async () => {
    await renderScreen();
    await screen.findByText('Ana');
    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
    expect(await screen.findByText('Ben')).toBeOnTheScreen();
    expect(listMock).toHaveBeenLastCalledWith('all', undefined);
    expect(screen.getByRole('radio', { name: 'All, selected' })).toBeOnTheScreen();
    expect(screen.getByText('Ed')).toBeOnTheScreen();
  });

  it('stays on screen when Pending is empty, so the seller can switch to All', async () => {
    server.rows = mixedRows().map((r) => ({
      ...r,
      status: 'declined',
      display_status: 'declined',
    }));
    await renderScreen();
    expect(await screen.findByText('Nothing waiting for you right now.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
    expect(await screen.findByText('Ana')).toBeOnTheScreen();
  });
});

describe('states', () => {
  it('loading: a skeleton with a label, and the filter is already there', async () => {
    listMock.mockImplementation(() => new Promise(() => undefined));
    await renderScreen();
    expect(await screen.findByLabelText('Loading requests')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Pending, selected' })).toBeOnTheScreen();
  });

  it('empty (All): the spec wording', async () => {
    server.rows = [];
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'All' }));
    expect(
      await screen.findByText(
        'No requests yet. Customers who send you requests will show up here.',
      ),
    ).toBeOnTheScreen();
  });

  it('error with Try again, then the list', async () => {
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await renderScreen();
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ana')).toBeOnTheScreen();
  });

  it('a server error that is not a network error gets the plain message', async () => {
    listMock.mockRejectedValueOnce(new RequestAppError('unknown'));
    await renderScreen();
    expect(await screen.findByText("We couldn't load your requests. Try again.")).toBeOnTheScreen();
  });

  it('success: every row is a button with the status as a word', async () => {
    await renderScreen();
    await screen.findByText('Ana');
    expect(screen.getAllByText('Waiting').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: /^Pickup\. Request from / })).toHaveLength(2);
  });

  it('a pending request is never described as accepted or confirmed anywhere on the list', async () => {
    server.rows = makeSellerRows(3, { status: 'pending' });
    await renderScreen();
    await screen.findByText('Customer 1');
    expect(
      within(screen.getByTestId('inbox-list')).queryByText(/accepted|confirm|book/i),
    ).not.toBeOnTheScreen();
    for (const row of screen.getAllByRole('button', { name: /^Pickup\. Request from / })) {
      expect(row.props.accessibilityLabel).not.toMatch(/accepted|confirm|book/i);
    }
  });

  it("shows the server's Expired for a pending request past its expiry (the phone does not decide)", async () => {
    server.rows = [
      makeSellerRequest({
        id: '00000000-0000-4000-8000-0000000000aa',
        customer_name: 'Zed',
        status: 'pending',
        display_status: 'expired',
      }),
    ];
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'All' }));
    expect(await screen.findByText('Zed')).toBeOnTheScreen();
    expect(screen.getByText('Expired')).toBeOnTheScreen();
    const label = screen.getByRole('button', { name: /^Pickup\. Request from Zed/ }).props
      .accessibilityLabel as string;
    expect(label).toContain('Status: Expired');
    expect(label).not.toContain('Waiting');
  });

  it('opens a request with a tap', async () => {
    const onOpen = jest.fn();
    await renderScreen(onOpen);
    await fireEvent.press(
      await screen.findByRole('button', { name: /^Pickup\. Request from Ana/ }),
    );
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ customer_name: 'Ana' }));
  });
});

describe('an empty list', () => {
  it('empty Pending picks up a new request after 30 s', async () => {
    jest.useFakeTimers();
    server.rows = mixedRows().map((r) => ({
      ...r,
      status: 'declined',
      display_status: 'declined',
    }));
    await renderScreen();
    expect(await screen.findByText('Nothing waiting for you right now.')).toBeOnTheScreen();

    server.rows = [
      ...server.rows,
      makeSellerRequest({ id: '00000000-0000-4000-8000-0000000000ff', customer_name: 'Newcomer' }),
    ];
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
    });
    expect(await screen.findByText('Newcomer')).toBeOnTheScreen();
    expect(screen.queryByText('Nothing waiting for you right now.')).not.toBeOnTheScreen();
  });

  it('a refetch that fails while the list is empty shows the error with Try again, not the empty state', async () => {
    server.rows = [];
    await renderScreen();
    expect(await screen.findByText('Nothing waiting for you right now.')).toBeOnTheScreen();

    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    expect(screen.queryByText('Nothing waiting for you right now.')).not.toBeOnTheScreen();

    server.rows = mixedRows();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ana')).toBeOnTheScreen();
  });
});

describe('loading more as you scroll', () => {
  beforeEach(() => {
    server.rows = makeSellerRows(120);
  });
  const allFilter = async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'All' }));
    await screen.findByText('Customer 1');
  };

  it("reads the next page with the server's cursor text, once", async () => {
    await allFilter();
    const cursor = (await listMock.mock.results.at(-1)?.value).next_cursor as string;
    expect(cursor).toMatch(/\.123456Z\|/);
    await endReached();
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('all', cursor));
  });

  it('does not ask again while a page is loading, and shows a footer spinner', async () => {
    await allFilter();
    let finish: () => void = () => undefined;
    const real = sellerPagedServer(server);
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => void real('all', undefined).then(resolve);
        }),
    );
    const before = listMock.mock.calls.length;
    await endReached();
    expect(await screen.findByLabelText('Loading more requests')).toBeOnTheScreen();
    await endReached();
    await endReached();
    expect(listMock.mock.calls.length).toBe(before + 1);
    await act(async () => finish());
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading more requests')).not.toBeOnTheScreen(),
    );
  });

  it('a failed next page: an inline Try again, the rows stay, and it does not hammer', async () => {
    await allFilter();
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await endReached();
    expect(await screen.findByText("Couldn't load more requests.")).toBeOnTheScreen();
    expect(screen.getByText('Customer 1')).toBeOnTheScreen();
    expect(screen.queryByText(/No connection/)).not.toBeOnTheScreen();
    const calls = listMock.mock.calls.length;
    await endReached();
    expect(listMock.mock.calls.length).toBe(calls);
    await fireEvent.press(screen.getByRole('button', { name: 'Try loading more requests again' }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load more requests.")).not.toBeOnTheScreen(),
    );
  });

  it('120 requests sharing one created_at are all reachable, none repeated', async () => {
    server.rows = makeSellerRows(120, { sharedCreatedAt: '2026-11-08T16:00:00.654321+00:00' });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'All' }));
    // Ties are listed highest id first, the server's order.
    await screen.findByText('Customer 120');
    // Keep reaching the end until the last page is in (the end-reached guard allows one read at a time).
    await waitFor(
      async () => {
        await endReached();
        expect(screen.getByTestId('inbox-list').props.data).toHaveLength(120);
      },
      { timeout: 5000 },
    );
    const list = screen.getByTestId('inbox-list');
    expect(new Set(list.props.data.map((r: SellerRequest) => r.id)).size).toBe(120);
  });
});

describe('refreshing', () => {
  it('a failed refresh (app comes back to the front) is a small banner and the list stays', async () => {
    await renderScreen();
    await screen.findByText('Ana');
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText("Couldn't refresh your requests.")).toBeOnTheScreen();
    expect(screen.getByText('Ana')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try refreshing again' }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't refresh your requests.")).not.toBeOnTheScreen(),
    );
  });

  it('a failed pull keeps the rows and shows the banner; Try again recovers', async () => {
    await renderScreen();
    await screen.findByText('Ana');
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await pull();
    expect(await screen.findByText("Couldn't refresh your requests.")).toBeOnTheScreen();
    expect(screen.getByText('Ana')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try refreshing again' }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't refresh your requests.")).not.toBeOnTheScreen(),
    );
  });

  it('a pull starts again from the newest 50 of the current filter with one read', async () => {
    await renderScreen();
    await screen.findByText('Ana');
    listMock.mockClear();
    await pull();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(listMock).toHaveBeenCalledWith('pending', undefined);
  });

  it('shows a request that arrived meanwhile after a pull', async () => {
    await renderScreen();
    await screen.findByText('Ana');
    server.rows = [
      makeSellerRequest({
        id: '99999999-0000-4000-8000-000000000001',
        customer_name: 'Newcomer',
        created_at: '2026-11-08T17:05:00.000001+00:00',
      }),
      ...server.rows,
    ];
    await pull();
    expect(await screen.findByText('Newcomer')).toBeOnTheScreen();
  });
});
