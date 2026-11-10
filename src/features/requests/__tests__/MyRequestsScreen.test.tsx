import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCurrencies } from '@/features/menu/api';

import { dump } from '../__fixtures__/dump';
import { makeRequest } from '../__fixtures__/requests';
import { getMyPickupAddress, listMyRequests, RequestAppError } from '../api';
import { MyRequestsScreen } from '../components/MyRequestsScreen';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyRequests: jest.fn(),
  getMyPickupAddress: jest.fn(),
}));

const listMock = jest.mocked(listMyRequests);
const addressMock = jest.mocked(getMyPickupAddress);
const onBack = jest.fn();
const onOpen = jest.fn();
const onFindPlace = jest.fn();

const SERVER_NOW = '2026-11-08T17:00:00Z';
const AUCKLAND = { timeZone: 'Pacific/Auckland', locale: 'en-US' };
const pending = makeRequest({ id: 'r-pending' });
const expired = makeRequest({
  id: 'r-expired',
  business_name: 'Slow Pizza',
  status: 'pending',
  display_status: 'expired',
  expires_at: '2026-11-08T16:30:00+00:00',
});
const declined = makeRequest({
  id: 'r-declined',
  business_name: 'Nonna Rosa',
  business_type: 'homemade',
  status: 'declined',
  display_status: 'declined',
});
const accepted = makeRequest({
  id: 'r-accepted',
  business_name: 'Nonna Rosa',
  business_type: 'homemade',
  status: 'accepted',
  display_status: 'accepted',
});

let client: QueryClient;
function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <MyRequestsScreen onBack={onBack} onOpen={onOpen} onFindPlace={onFindPlace} {...AUCKLAND} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  listMock.mockReset();
  addressMock.mockReset();
  jest
    .mocked(getCurrencies)
    .mockResolvedValue([{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }]);
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

describe('states', () => {
  it('loading: skeletons with one spoken label', async () => {
    listMock.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    expect(screen.getByLabelText('Loading requests')).toBeOnTheScreen();
  });

  it('empty: says what to do and offers the map', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [] });
    await renderScreen();
    expect(
      await screen.findByText('No requests yet. Find a place on the map and request pickup.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Find a place' }));
    expect(onFindPlace).toHaveBeenCalledTimes(1);
  });

  it('error: a message with Try again that reloads', async () => {
    listMock.mockRejectedValueOnce(new RequestAppError('network'));
    await renderScreen();
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    listMock.mockResolvedValueOnce({ server_now: SERVER_NOW, next_cursor: null, requests: [pending] });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText("Joe's Pizza")).toBeOnTheScreen();
  });

  it('success: a row per request, newest first as the server sent them', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending, declined, accepted] });
    await renderScreen();
    await screen.findByText("Joe's Pizza");
    const rows = screen.getAllByRole('button', { name: /Status:/ });
    expect(rows).toHaveLength(3);
    expect(rows[0].props.accessibilityLabel).toContain("Joe's Pizza");
    expect(rows[1].props.accessibilityLabel).toContain('Declined');
  });

  it('Back and opening a row call back', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending] });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Status: Waiting/ }));
    expect(onOpen).toHaveBeenCalledWith(pending);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('what a row says', () => {
  it('pending: Waiting, never confirmed, in text or in the spoken label', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending] });
    await renderScreen();
    const row = await screen.findByRole('button', { name: /Status: Waiting/ });
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(screen.getByText("Waiting for Joe's Pizza to respond")).toBeOnTheScreen();
    expect(row.props.accessibilityLabel).not.toMatch(/confirm|booked|accepted|on its way/i);
    expect(dump()).not.toMatch(/confirm|booked|on its way/i);
  });

  it('every status is a word plus an icon on the row', async () => {
    listMock.mockResolvedValue({
      server_now: SERVER_NOW,
      next_cursor: null,
      requests: [pending, expired, declined, accepted],
    });
    await renderScreen();
    await screen.findByText('Slow Pizza');
    for (const word of ['Waiting', 'Expired', 'Declined', 'Accepted']) {
      expect(screen.getByLabelText(`Status: ${word}`)).toBeOnTheScreen();
    }
  });

  it('shows the pickup time in the chosen zone', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending] });
    await renderScreen();
    await screen.findByText("Joe's Pizza");
    // 18:00 UTC on Nov 8 is 07:00 on Nov 9 in Auckland.
    expect(screen.getByText('Pickup Mon, Nov 9, 7:00 AM')).toBeOnTheScreen();
  });

  it('is a 44 pt target with a button role', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending] });
    await renderScreen();
    const row = await screen.findByRole('button', { name: /Status: Waiting/ });
    const flat = Object.assign({}, ...[row.props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('never shows an address, and never asks for one, in the list', async () => {
    addressMock.mockResolvedValue({ formatted_address: '12 Secret Lane, Oshawa' });
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [accepted, declined] });
    await renderScreen();
    await screen.findAllByText('Nonna Rosa');
    expect(addressMock).not.toHaveBeenCalled();
    expect(dump()).not.toMatch(/Secret Lane|formatted_address/);
  });
});

describe('the server decides the status, not the phone clock', () => {
  // Only Date is faked, so timers and promises still run.
  const fakeClock = (iso: string) =>
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });

  it.each([
    ['5 hours ahead', '2026-11-08T22:00:00Z'],
    ['5 hours behind', '2026-11-08T12:00:00Z'],
  ])(
    'phone clock %s: a live request stays Waiting, an expired one stays Expired',
    async (_label, phone) => {
      fakeClock(phone);
      // The server says: this one is still pending (expires 17:30, server now 17:00) and that one
      // expired. A phone 5 hours ahead would call both expired; 5 hours behind, both pending.
      listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending, expired] });
      await renderScreen();
      await screen.findByText("Joe's Pizza");
      expect(
        screen.getByRole('button', { name: /Joe's Pizza. Status: Waiting/ }),
      ).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: /Slow Pizza. Status: Expired/ })).toBeOnTheScreen();
      expect(screen.queryByLabelText('Status: Waiting')).toBeOnTheScreen();
      expect(screen.getAllByLabelText('Status: Expired')).toHaveLength(1);
    },
  );
});

describe('refetch', () => {
  it('re-reads the list when the app comes back to the front', async () => {
    listMock.mockResolvedValue({ server_now: SERVER_NOW, next_cursor: null, requests: [pending] });
    await renderScreen();
    await screen.findByText("Joe's Pizza");
    expect(listMock).toHaveBeenCalledTimes(1);
    listMock.mockResolvedValue({
      server_now: SERVER_NOW,
      next_cursor: null,
      requests: [{ ...pending, status: 'accepted', display_status: 'accepted' }],
    });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByLabelText('Status: Accepted')).toBeOnTheScreen();
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
