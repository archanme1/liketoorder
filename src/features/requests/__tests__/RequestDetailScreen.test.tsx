import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCurrencies } from '@/features/menu/api';

import { dump } from '../__fixtures__/dump';
import { makeRequest, REQUEST_ID } from '../__fixtures__/requests';
import { cancelPickupRequest, getMyPickupAddress, getPickupRequest, RequestAppError } from '../api';
import { ADDRESS_UNAVAILABLE } from '../components/RequestAddressCard';
import { RequestDetailScreen } from '../components/RequestDetailScreen';
import { requestKeys } from '../hooks/keys';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getPickupRequest: jest.fn(),
  cancelPickupRequest: jest.fn(),
  getMyPickupAddress: jest.fn(),
}));

const getMock = jest.mocked(getPickupRequest);
const cancelMock = jest.mocked(cancelPickupRequest);
const addressMock = jest.mocked(getMyPickupAddress);
const onBack = jest.fn();

const SERVER_NOW = '2026-11-08T17:00:00Z';
const ADDRESS = '12 Maple Lane, Oshawa, ON, Canada';
const homemade = (over: object = {}) =>
  makeRequest({
    business_name: 'Nonna Rosa',
    business_type: 'homemade',
    status: 'accepted',
    display_status: 'accepted',
    ...over,
  });

let client: QueryClient;
function renderScreen(requestId: string | null = REQUEST_ID) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <RequestDetailScreen
          requestId={requestId}
          onBack={onBack}
          timeZone="Pacific/Auckland"
          locale="en-US"
        />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}
const serve = (request: ReturnType<typeof makeRequest> | null) =>
  getMock.mockResolvedValue({ server_now: SERVER_NOW, request });

beforeEach(() => {
  jest.clearAllMocks();
  [getMock, cancelMock, addressMock].forEach((mock) => mock.mockReset());
  jest
    .mocked(getCurrencies)
    .mockResolvedValue([{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }]);
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('states', () => {
  it('loading: one spoken label', async () => {
    getMock.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    expect(screen.getByLabelText('Loading request')).toBeOnTheScreen();
  });

  it('not found (unknown, someone else, or a bad link): one calm message', async () => {
    serve(null);
    await renderScreen();
    expect(await screen.findByText("We couldn't find that request.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a bad link never asks the server', async () => {
    await renderScreen(null);
    expect(screen.getByText("We couldn't find that request.")).toBeOnTheScreen();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('error: message with Try again that reloads', async () => {
    getMock.mockRejectedValueOnce(new RequestAppError('network'));
    await renderScreen();
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    serve(makeRequest());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: "Joe's Pizza" })).toBeOnTheScreen();
  });

  it('success: seller, status as a word, pickup time in the zone, order, total', async () => {
    serve(makeRequest({ note: 'ring the bell', order_text: 'extra napkins' }));
    await renderScreen();
    expect(await screen.findByRole('header', { name: "Joe's Pizza" })).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: Waiting')).toBeOnTheScreen();
    expect(screen.getByText('Mon, Nov 9, 7:00 AM')).toBeOnTheScreen();
    expect(screen.getByText('2 × Margherita')).toBeOnTheScreen();
    expect(screen.getByText('CA$25.00')).toBeOnTheScreen();
    expect(screen.getByText('Estimated total: CA$25.00')).toBeOnTheScreen();
    expect(screen.getByText('extra napkins')).toBeOnTheScreen();
    expect(screen.getByText('ring the bell')).toBeOnTheScreen();
  });

  it('a pending request is never worded as confirmed', async () => {
    serve(makeRequest());
    await renderScreen();
    await screen.findByText("Waiting for Joe's Pizza to respond");
    expect(dump()).not.toMatch(/confirm|booked|on its way/i);
    expect(screen.getByText(/this request expires/)).toBeOnTheScreen();
  });

  it('shows the server status as sent (Expired), whatever the expiry time says', async () => {
    serve(makeRequest({ status: 'pending', display_status: 'expired' }));
    await renderScreen();
    expect(await screen.findByLabelText('Status: Expired')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeOnTheScreen();
  });
});

describe('cancel', () => {
  it('is offered only while pending', async () => {
    for (const status of [
      'accepted',
      'declined',
      'expired',
      'cancelled',
      'completed',
      'no_show',
    ] as const) {
      serve(makeRequest({ status, display_status: status }));
      await renderScreen();
      await screen.findByRole('header', { name: "Joe's Pizza" });
      expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeOnTheScreen();
      await cleanup();
      client.clear();
    }
    serve(makeRequest());
    await renderScreen();
    expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeOnTheScreen();
  });

  it('asks first; Keep request goes back without cancelling', async () => {
    serve(makeRequest());
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    expect(screen.getByText('Cancel this request?')).toBeOnTheScreen();
    expect(cancelMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep request' }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeOnTheScreen();
  });

  it('confirming cancels once (a double tap is one call) and refetches the detail', async () => {
    serve(makeRequest());
    let finish: (value: ReturnType<typeof makeRequest>) => void = () => undefined;
    cancelMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    const yes = screen.getByRole('button', { name: 'Yes, cancel request' });
    await fireEvent.press(yes);
    await fireEvent.press(yes);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith(REQUEST_ID);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Yes, cancel request' })).toHaveProp(
        'accessibilityState',
        { disabled: true, busy: true },
      ),
    );
    serve(makeRequest({ status: 'cancelled', display_status: 'cancelled' }));
    await act(async () =>
      finish(makeRequest({ status: 'cancelled', display_status: 'cancelled' })),
    );
    expect(await screen.findByLabelText('Status: Cancelled')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeOnTheScreen();
  });

  it('invalidates the list so My requests shows the new status', async () => {
    serve(makeRequest());
    cancelMock.mockResolvedValue(makeRequest({ status: 'cancelled', display_status: 'cancelled' }));
    await renderScreen();
    client.setQueryData(requestKeys.mine, { server_now: SERVER_NOW, requests: [makeRequest()] });
    expect(client.getQueryState(requestKeys.mine)?.isInvalidated).toBe(false);
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, cancel request' }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryState(requestKeys.mine)?.isInvalidated).toBe(true));
  });

  it('a failed cancel says why and re-reads the request', async () => {
    serve(makeRequest());
    cancelMock.mockRejectedValue(new RequestAppError('invalid_transition'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    serve(makeRequest({ status: 'accepted', display_status: 'accepted' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, cancel request' }));
    expect(await screen.findByText("This request can't be cancelled any more.")).toBeOnTheScreen();
    expect(await screen.findByLabelText('Status: Accepted')).toBeOnTheScreen();
  });
});

describe('the exact address', () => {
  it.each(['accepted', 'completed'] as const)(
    "shows the cook's address and the food-safety note when a homemade request is %s",
    async (status) => {
      addressMock.mockResolvedValue({ formatted_address: ADDRESS });
      serve(homemade({ status, display_status: status }));
      await renderScreen();
      expect(await screen.findByText(ADDRESS)).toBeOnTheScreen();
      expect(addressMock).toHaveBeenCalledWith(REQUEST_ID);
      expect(screen.getByText('Food safety and allergies')).toBeOnTheScreen();
      expect(screen.getByText(/Homemade food isn't inspected/)).toBeOnTheScreen();
    },
  );

  it.each(['pending', 'declined', 'expired', 'cancelled', 'no_show'] as const)(
    'never asks for it, and shows none, when a homemade request is %s',
    async (status) => {
      addressMock.mockResolvedValue({ formatted_address: ADDRESS });
      serve(homemade({ status, display_status: status }));
      await renderScreen();
      await screen.findByRole('header', { name: 'Nonna Rosa' });
      expect(addressMock).not.toHaveBeenCalled();
      expect(screen.queryByText('Pickup address')).not.toBeOnTheScreen();
      expect(dump()).not.toContain('Maple Lane');
    },
  );

  it('never for a restaurant, even accepted', async () => {
    addressMock.mockResolvedValue({ formatted_address: ADDRESS });
    serve(makeRequest({ status: 'accepted', display_status: 'accepted' }));
    await renderScreen();
    await screen.findByRole('header', { name: "Joe's Pizza" });
    expect(addressMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Pickup address')).not.toBeOnTheScreen();
  });

  it('shows only what the server returns: null means "not available", never a stale address', async () => {
    addressMock.mockResolvedValue(null);
    serve(homemade());
    await renderScreen();
    expect(await screen.findByText(ADDRESS_UNAVAILABLE)).toBeOnTheScreen();
    expect(dump()).not.toContain('Maple Lane');
  });

  it('address error has Retry', async () => {
    addressMock.mockRejectedValueOnce(new RequestAppError('network'));
    serve(homemade());
    await renderScreen();
    expect(await screen.findByText("We couldn't load the address. Try again.")).toBeOnTheScreen();
    addressMock.mockResolvedValue({ formatted_address: ADDRESS });
    await fireEvent.press(screen.getByRole('button', { name: 'Retry loading the address' }));
    expect(await screen.findByText(ADDRESS)).toBeOnTheScreen();
  });

  it('drops the cached address when the request is no longer accepted', async () => {
    addressMock.mockResolvedValue({ formatted_address: ADDRESS });
    serve(homemade());
    await renderScreen();
    await screen.findByText(ADDRESS);
    expect(client.getQueryData(requestKeys.address(REQUEST_ID))).toBeTruthy();
    serve(homemade({ status: 'no_show', display_status: 'no_show' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: requestKeys.detail(REQUEST_ID) });
    });
    await waitFor(() => expect(screen.queryByText(ADDRESS)).not.toBeOnTheScreen());
    await waitFor(() =>
      expect(client.getQueryData(requestKeys.address(REQUEST_ID))).toBeUndefined(),
    );
  });
});

describe('total and prices', () => {
  it('says the total leaves out items without a price', async () => {
    serve(
      makeRequest({
        items: [
          { item_id: 'a', name: 'Margherita', unit_price_minor: 1250, quantity: 1 },
          { item_id: 'b', name: 'House salad', unit_price_minor: null, quantity: 1 },
        ],
      }),
    );
    await renderScreen();
    expect(await screen.findByText('Total excludes items without a price')).toBeOnTheScreen();
  });

  it('shows no symbol and no total when the business had no currency', async () => {
    serve(makeRequest({ currency_code: null }));
    await renderScreen();
    await screen.findByText('2 × Margherita');
    expect(screen.queryByText(/Estimated total/)).not.toBeOnTheScreen();
    expect(dump()).not.toMatch(/[$€£¥]/);
  });
});
