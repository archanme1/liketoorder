import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getBusinessRequest } from '../api';
import { SellerRequestDetailScreen } from '../components/SellerRequestDetailScreen';
import type { SellerTableRequest } from '../schema';

import { dump } from '../__fixtures__/dump';
import { makeSellerTableRequest, TABLE_REQUEST_ID } from '../__fixtures__/tableRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn().mockResolvedValue([]),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getBusinessRequest: jest.fn(),
}));

const getMock = jest.mocked(getBusinessRequest);
const onClose = jest.fn();
// The table is at 2026-11-09 00:00 UTC.
const BEFORE = '2026-11-08T17:00:00Z';
const AFTER = '2026-11-09T00:30:00Z';

const serve = (request: SellerTableRequest | null, serverNow = BEFORE) =>
  getMock.mockResolvedValue({ server_now: serverNow, request });
const accepted = (over: Partial<SellerTableRequest> = {}) =>
  makeSellerTableRequest({ status: 'accepted', display_status: 'accepted', ...over });

let client: QueryClient;
function renderScreen(zone = 'America/Toronto') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SellerRequestDetailScreen
          requestId={TABLE_REQUEST_ID}
          onClose={onClose}
          timeZone={zone}
          locale="en-US"
        />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  getMock.mockReset();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await cleanup();
  client.clear();
});

describe('the restaurant owner detail of a table request', () => {
  it('shows the customer, the table time with its zone name, the party and the note', async () => {
    serve(makeSellerTableRequest({ note: 'window seat' }));
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Sam Rivera' })).toBeOnTheScreen();
    expect(screen.getByText('Sun, Nov 8, 7:00 PM EST')).toBeOnTheScreen();
    expect(screen.getByText('Party of 4')).toBeOnTheScreen();
    expect(screen.getByText('window seat')).toBeOnTheScreen();
    // A table has no order and no total.
    expect(screen.queryByText('Order')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Estimated total/)).not.toBeOnTheScreen();
  });

  it('the same instant in another zone shows that zone (explicit-zone test)', async () => {
    serve(makeSellerTableRequest());
    await renderScreen('Pacific/Auckland');
    await screen.findByRole('header', { name: 'Sam Rivera' });
    expect(screen.getByText(/^Mon, Nov 9, 1:00 PM \S+$/)).toBeOnTheScreen();
    expect(screen.queryByText(/EST/)).not.toBeOnTheScreen();
  });

  it('a pending request offers Accept and Decline and never reads as accepted or confirmed', async () => {
    serve(makeSellerTableRequest());
    await renderScreen();
    expect(await screen.findByRole('button', { name: /^Accept request/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Decline request/ })).toBeOnTheScreen();
    expect(screen.getByText('Waiting for your answer')).toBeOnTheScreen();
    expect(dump()).not.toMatch(/confirm|booked|you accepted/i);
  });

  it('says "Customer has arrived" once the customer tapped I have arrived', async () => {
    serve(accepted({ arrived_at: '2026-11-08T23:30:00+00:00' }));
    await renderScreen();
    expect(await screen.findByText('Customer has arrived')).toBeOnTheScreen();
    expect(screen.getByText('Arrived Sun, Nov 8, 6:30 PM')).toBeOnTheScreen();
  });

  it('does not say it when the customer has not arrived', async () => {
    serve(accepted());
    await renderScreen();
    await screen.findByRole('header', { name: 'Sam Rivera' });
    expect(screen.queryByText('Customer has arrived')).not.toBeOnTheScreen();
  });

  it('Completed and No-show wait for the table time on the SERVER clock', async () => {
    serve(accepted(), BEFORE);
    await renderScreen();
    await screen.findByRole('header', { name: 'Sam Rivera' });
    expect(screen.queryByRole('button', { name: /Mark completed/ })).not.toBeOnTheScreen();
    await cleanup();
    client.clear();

    serve(accepted(), AFTER);
    await renderScreen();
    expect(await screen.findByRole('button', { name: /Mark completed/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Mark no-show/ })).toBeOnTheScreen();
  });

  it('a phone clock a year ahead does not bring Completed forward (the server clock decides)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 365 * 24 * 3_600_000);
    serve(accepted(), BEFORE);
    await renderScreen();
    await screen.findByRole('header', { name: 'Sam Rivera' });
    expect(screen.queryByRole('button', { name: /Mark completed/ })).not.toBeOnTheScreen();
  });

  it('a declined request shows the table reason', async () => {
    serve(
      makeSellerTableRequest({
        status: 'declined',
        display_status: 'declined',
        decline_reason: 'fully_booked',
      }),
    );
    await renderScreen();
    expect(await screen.findByText('Declined: Fully booked')).toBeOnTheScreen();
  });
});
