import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RequestAppError, listBusinessRequests } from '../api';
import { SellerRequestsScreen } from '../components/SellerRequestsScreen';
import type { BusinessRequest } from '../schema';

import {
  makeMixedSellerRows,
  makeSellerRows,
  sellerPagedServer,
} from '../__fixtures__/sellerRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listBusinessRequests: jest.fn(),
}));

const listMock = jest.mocked(listBusinessRequests);
const server: { rows: BusinessRequest[] } = { rows: [] };
let client: QueryClient;

// The screen as Manage Business > Requests renders it (the Requests tab renders the same one).
function screenTree() {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SellerRequestsScreen onOpen={jest.fn()} timeZone="America/Toronto" locale="en-CA" />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** One row per status, named by status. */
function everyStatus(): BusinessRequest[] {
  const statuses = [
    'pending',
    'accepted',
    'completed',
    'no_show',
    'declined',
    'cancelled',
    'expired',
  ] as const;
  return makeMixedSellerRows(statuses.length).map((row, i) => ({
    ...row,
    customer_name: `Cust ${statuses[i]}`,
    status: statuses[i],
    display_status: statuses[i],
  }));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  server.rows = everyStatus();
  listMock.mockReset();
  listMock.mockImplementation(sellerPagedServer(server));
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

const shownRows = () =>
  screen.getAllByRole('button', { name: /^(Pickup|Table)\. Request from Cust / });
const chip = (name: string) => screen.getByRole('radio', { name });

describe('Received filters', () => {
  it('opens on Pending with four chips under "Filter received requests", asking the server for pending', async () => {
    await render(screenTree());
    expect(await screen.findByRole('button', { name: /Cust pending/ })).toBeOnTheScreen();
    expect(listMock).toHaveBeenCalledWith('pending', undefined);
    expect(screen.getByLabelText('Filter received requests').props.accessibilityRole).toBe(
      'radiogroup',
    );
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'All',
      'Pending, selected',
      'Accepted',
      'Declined',
    ]);
    expect(shownRows()).toHaveLength(1);
  });

  it.each([
    ['All', 'all', 7],
    ['Accepted', 'accepted', 3],
    ['Declined', 'declined', 1],
  ])('%s asks the server for %s and shows only its rows', async (label, value, count) => {
    await render(screenTree());
    await screen.findByRole('button', { name: /Cust pending/ });
    await fireEvent.press(chip(label));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(value, undefined));
    await waitFor(() => expect(shownRows()).toHaveLength(count));
    expect(screen.getByRole('radio', { name: `${label}, selected` })).toBeOnTheScreen();
    if (label !== 'All') {
      expect(screen.queryByRole('button', { name: /Cust (cancelled|expired|pending)/ })).toBeNull();
    }
  });

  it.each([
    ['All', 'No requests yet. Customers who send you requests will show up here.'],
    ['Pending', 'Nothing waiting for you right now.'],
    ['Accepted', 'No accepted requests yet.'],
    ['Declined', 'No declined requests.'],
  ])('empty %s says "%s"', async (label, text) => {
    server.rows = [];
    await render(screenTree());
    await screen.findByText('Nothing waiting for you right now.');
    if (label !== 'Pending') await fireEvent.press(chip(label));
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('a filtered list loads more on scroll with the cursor, under the same filter', async () => {
    server.rows = [
      ...makeMixedSellerRows(130).map((r, i) => ({
        ...r,
        status: i % 2 ? ('completed' as const) : ('no_show' as const),
        display_status: i % 2 ? ('completed' as const) : ('no_show' as const),
      })),
      ...everyStatus().map((r, i) => ({
        ...r,
        id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      })),
    ];
    await render(screenTree());
    await screen.findByRole('button', { name: /Cust pending/ });
    await fireEvent.press(chip('Accepted'));
    await waitFor(() => expect(screen.getByTestId('inbox-list').props.data).toHaveLength(50));
    const cursor = (await listMock.mock.results.at(-1)?.value).next_cursor as string;
    await act(async () => fireEvent(screen.getByTestId('inbox-list'), 'endReached'));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('accepted', cursor));
    await waitFor(
      async () => {
        await act(async () => fireEvent(screen.getByTestId('inbox-list'), 'endReached'));
        expect(screen.getByTestId('inbox-list').props.data).toHaveLength(133);
      },
      { timeout: 5000 },
    );
    const data = screen.getByTestId('inbox-list').props.data as BusinessRequest[];
    expect(new Set(data.map((r) => r.id)).size).toBe(133);
    expect(new Set(data.map((r) => r.kind))).toEqual(new Set(['pickup', 'table']));
  });

  it('a filter that fails to load shows the error with Try again, then its rows', async () => {
    await render(screenTree());
    await screen.findByRole('button', { name: /Cust pending/ });
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await fireEvent.press(chip('Declined'));
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(shownRows()).toHaveLength(1));
  });

  it('a pending request never shows under Accepted', async () => {
    server.rows = makeSellerRows(3, { status: 'pending' });
    await render(screenTree());
    await screen.findByText('Customer 1');
    await fireEvent.press(chip('Accepted'));
    expect(await screen.findByText('No accepted requests yet.')).toBeOnTheScreen();
    expect(screen.queryByText('Customer 1')).toBeNull();
  });

  it('Manage Business: opening the screen again starts on Pending (a stack screen keeps no choice)', async () => {
    const first = await render(screenTree());
    await screen.findByRole('button', { name: /Cust pending/ });
    await fireEvent.press(chip('Declined'));
    expect(screen.getByRole('radio', { name: 'Declined, selected' })).toBeOnTheScreen();
    await first.unmount();
    await render(screenTree());
    expect(await screen.findByRole('radio', { name: 'Pending, selected' })).toBeOnTheScreen();
  });
});
