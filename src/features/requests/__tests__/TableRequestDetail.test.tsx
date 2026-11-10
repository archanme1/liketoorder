import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { dump } from '../__fixtures__/dump';
import { makeRequest, REQUEST_ID } from '../__fixtures__/requests';
import { makeTableRequest, TABLE_REQUEST_ID } from '../__fixtures__/tableRequests';
import {
  cancelTableRequest,
  getMyTableRequest,
  getPickupRequest,
  markArrived,
  RequestAppError,
} from '../api';
import { RequestDetailScreen } from '../components/RequestDetailScreen';
import type { RequestKind } from '../kind';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn().mockResolvedValue([]),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getPickupRequest: jest.fn(),
  getMyTableRequest: jest.fn(),
  cancelTableRequest: jest.fn(),
  markArrived: jest.fn(),
}));

const pickupMock = jest.mocked(getPickupRequest);
const tableMock = jest.mocked(getMyTableRequest);
const cancelMock = jest.mocked(cancelTableRequest);
const arrivedMock = jest.mocked(markArrived);
const onBack = jest.fn();
const SERVER_NOW = '2026-11-08T17:00:00Z';

let client: QueryClient;
function renderScreen(
  zone: { timeZone: string; locale: string } = { timeZone: 'America/Toronto', locale: 'en-US' },
  kind: RequestKind | null = 'table',
  id: string = TABLE_REQUEST_ID,
) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <RequestDetailScreen requestId={id} kind={kind} onBack={onBack} {...zone} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}
const serve = (request: ReturnType<typeof makeTableRequest> | null) =>
  tableMock.mockResolvedValue({ server_now: SERVER_NOW, request });

beforeEach(() => {
  jest.clearAllMocks();
  [pickupMock, tableMock, cancelMock, arrivedMock].forEach((mock) => mock.mockReset());
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('a table request: the detail', () => {
  it('shows the restaurant, the status as a word, the table time with its zone, the party and the note', async () => {
    serve(makeTableRequest({ note: 'window seat' }));
    await renderScreen();
    expect(await screen.findByRole('header', { name: "Luigi's" })).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: Waiting')).toBeOnTheScreen();
    // 2026-11-09 00:00 UTC is 7:00 PM on Nov 8 in Toronto (EST).
    expect(screen.getByText('Sun, Nov 8, 7:00 PM EST')).toBeOnTheScreen();
    expect(screen.getByText('Party of 4')).toBeOnTheScreen();
    expect(screen.getByText('window seat')).toBeOnTheScreen();
  });

  it("the same instant in another zone shows that zone's time and name (explicit-zone test)", async () => {
    serve(makeTableRequest());
    await renderScreen({ timeZone: 'Pacific/Auckland', locale: 'en-US' });
    await screen.findByRole('header', { name: "Luigi's" });
    expect(screen.getByText(/^Mon, Nov 9, 1:00 PM \S+$/)).toBeOnTheScreen();
    expect(screen.queryByText(/EST/)).not.toBeOnTheScreen();
  });

  it('a pending request is never worded as accepted or confirmed, in text or in labels', async () => {
    serve(makeTableRequest());
    await renderScreen();
    await screen.findByText("Waiting for Luigi's to respond");
    expect(dump()).not.toMatch(/accepted|confirm|booked|on its way/i);
    expect(screen.getByText(/this request expires/)).toBeOnTheScreen();
  });

  it('shows the server status as sent (Expired), whatever the expiry time says', async () => {
    serve(makeTableRequest({ status: 'pending', display_status: 'expired' }));
    await renderScreen();
    expect(await screen.findByLabelText('Status: Expired')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeOnTheScreen();
  });

  it('declined: "Declined: <reason>" in the table words', async () => {
    serve(
      makeTableRequest({
        status: 'declined',
        display_status: 'declined',
        decline_reason: 'time_not_possible',
      }),
    );
    await renderScreen();
    expect(await screen.findByText("Declined: Time doesn't work")).toBeOnTheScreen();
  });

  it("declined with Other: the restaurant's own words", async () => {
    serve(
      makeTableRequest({
        status: 'declined',
        display_status: 'declined',
        decline_reason: 'other',
        response_note: 'Private party that night',
      }),
    );
    await renderScreen();
    expect(await screen.findByText('Declined: Private party that night')).toBeOnTheScreen();
  });

  it("accepted: the seller's note, and no cancel after acceptance", async () => {
    serve(
      makeTableRequest({
        status: 'accepted',
        display_status: 'accepted',
        response_note: 'See you at the bar',
      }),
    );
    await renderScreen();
    expect(await screen.findByText("Seller's note: See you at the bar")).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: Accepted')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeOnTheScreen();
  });

  it('not found: one calm message', async () => {
    serve(null);
    await renderScreen();
    expect(await screen.findByText("We couldn't find that request.")).toBeOnTheScreen();
  });
});

describe('which read the screen uses', () => {
  it('the kind hint decides: table reads the table call only', async () => {
    serve(makeTableRequest());
    await renderScreen();
    await screen.findByRole('header', { name: "Luigi's" });
    expect(pickupMock).not.toHaveBeenCalled();
  });

  it('a pickup request still opens as a pickup', async () => {
    pickupMock.mockResolvedValue({ server_now: SERVER_NOW, request: makeRequest() });
    await renderScreen(undefined, 'pickup', REQUEST_ID);
    expect(await screen.findByText('2 \u00D7 Margherita')).toBeOnTheScreen();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('no hint and no cached row: pickup first, then table', async () => {
    pickupMock.mockResolvedValue({ server_now: SERVER_NOW, request: null });
    serve(makeTableRequest());
    await renderScreen(undefined, null);
    expect(await screen.findByRole('header', { name: "Luigi's" })).toBeOnTheScreen();
    expect(pickupMock).toHaveBeenCalledTimes(1);
  });
});

describe('cancel a table request', () => {
  it('asks first; Keep request goes back without cancelling', async () => {
    serve(makeTableRequest());
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Keep request' }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeOnTheScreen();
  });

  it('a double tap sends one cancel, then re-reads and shows the real status', async () => {
    serve(makeTableRequest());
    let finish: (value: ReturnType<typeof makeTableRequest>) => void = () => undefined;
    cancelMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    const yes = screen.getByRole('button', { name: 'Yes, cancel request' });
    await fireEvent.press(yes);
    await fireEvent.press(yes);
    expect(cancelMock).toHaveBeenCalledTimes(1);

    const cancelled = makeTableRequest({ status: 'cancelled', display_status: 'cancelled' });
    serve(cancelled);
    await act(async () => finish(cancelled));
    expect(await screen.findByLabelText('Status: Cancelled')).toBeOnTheScreen();
  });

  it('a refused cancel says so and shows the real status after the re-read', async () => {
    serve(makeTableRequest());
    cancelMock.mockRejectedValue(new RequestAppError('invalid_transition'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel request' }));
    serve(makeTableRequest({ status: 'accepted', display_status: 'accepted' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, cancel request' }));
    expect(await screen.findByText("This request can't be cancelled any more.")).toBeOnTheScreen();
    expect(await screen.findByLabelText('Status: Accepted')).toBeOnTheScreen();
  });
});

describe('I have arrived on the customer detail', () => {
  const acceptedRequest = (over = {}) =>
    makeTableRequest({ status: 'accepted', display_status: 'accepted', ...over });

  it('shows the button inside the window by the server clock, and sends one call on a double tap', async () => {
    tableMock.mockResolvedValue({ server_now: '2026-11-08T23:30:00Z', request: acceptedRequest() });
    arrivedMock.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    const button = await screen.findByRole('button', { name: "Tell Luigi's you've arrived" });
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(arrivedMock).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the server clock is outside the window', async () => {
    tableMock.mockResolvedValue({ server_now: '2026-11-08T17:00:00Z', request: acceptedRequest() });
    await renderScreen();
    await screen.findByRole('header', { name: "Luigi's" });
    expect(screen.queryByRole('button', { name: /you've arrived/i })).not.toBeOnTheScreen();
  });

  it('once arrived, says so and offers no button', async () => {
    tableMock.mockResolvedValue({
      server_now: '2026-11-08T23:30:00Z',
      request: acceptedRequest({ arrived_at: '2026-11-08T23:20:00+00:00' }),
    });
    await renderScreen();
    expect(await screen.findByText("You've told the restaurant you arrived")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /you've arrived/i })).not.toBeOnTheScreen();
  });
});
