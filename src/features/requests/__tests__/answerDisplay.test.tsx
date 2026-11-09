import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCurrencies } from '@/features/menu/api';

import { answerLines } from '../answerLines';
import { getBusinessRequest, getPickupRequest } from '../api';
import { RequestDetailScreen } from '../components/RequestDetailScreen';
import { RequestRow } from '../components/RequestRow';
import { SellerRequestDetailScreen } from '../components/SellerRequestDetailScreen';
import { SellerRequestRow } from '../components/SellerRequestRow';
import type { PickupRequest, RequestStatus, SellerRequest } from '../schema';

import { REQUEST_ID, makeRequest } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';

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
  getBusinessRequest: jest.fn(),
  getMyPickupAddress: jest.fn(),
}));

const NOW = '2026-11-08T17:00:00Z';
const TZ = { timeZone: 'UTC', locale: 'en-US' };
const declined = (over: Partial<PickupRequest> = {}) =>
  makeRequest({ status: 'declined', display_status: 'declined', ...over });
const accepted = (over: Partial<PickupRequest> = {}) =>
  makeRequest({ status: 'accepted', display_status: 'accepted', ...over });

let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getCurrencies)
    .mockResolvedValue([{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }]);
});
afterEach(async () => {
  await cleanup();
  client?.clear();
});

async function renderScreen(ui: React.ReactElement) {
  // gcTime Infinity: the screen's request stays cached while the test reads the screen.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

describe('answerLines', () => {
  it('words a fixed decline reason, and the seller own words for Other', () => {
    expect(answerLines(declined({ decline_reason: 'sold_out' }))).toEqual(['Declined: Sold out']);
    expect(answerLines(declined({ decline_reason: 'other', response_note: 'Oven broke' }))).toEqual(
      ['Declined: Oven broke'],
    );
  });

  it('has no reason line for a request declined before spec 10b', () => {
    expect(answerLines(declined())).toEqual([]);
  });

  it('shows the seller note on an accepted, completed or no-show request', () => {
    for (const status of ['accepted', 'completed', 'no_show'] as RequestStatus[]) {
      expect(
        answerLines(makeRequest({ status, display_status: status, response_note: 'Bring a bag' })),
      ).toEqual(["Seller's note: Bring a bag"]);
    }
    expect(answerLines(accepted())).toEqual([]);
  });

  it('shows nothing for a pending, expired or cancelled request, even if a note were present', () => {
    for (const status of ['pending', 'expired', 'cancelled'] as RequestStatus[]) {
      expect(
        answerLines(
          makeRequest({
            status,
            display_status: status,
            response_note: 'Bring a bag',
            decline_reason: 'sold_out',
          }),
        ),
      ).toEqual([]);
    }
  });

  it('never words a pending request as accepted or confirmed', () => {
    const lines = answerLines(makeRequest({ response_note: 'Bring a bag' })).join(' ');
    expect(lines).not.toMatch(/accept|confirm/i);
  });
});

describe('the customer list row', () => {
  it('shows "Declined: <reason>" as text and speaks it', async () => {
    await render(
      <RequestRow request={declined({ decline_reason: 'too_busy' })} onPress={jest.fn()} {...TZ} />,
    );
    expect(screen.getByText('Declined: Too busy right now')).toBeOnTheScreen();
    const row = screen.getByRole('button');
    expect(row.props.accessibilityLabel).toContain('Declined: Too busy right now');
    expect(row.props.accessibilityLabel).toContain('Status: Declined');
  });

  it('shows the seller words for Other once, not also as a note', async () => {
    await render(
      <RequestRow
        request={declined({ decline_reason: 'other', response_note: 'Oven broke' })}
        onPress={jest.fn()}
        {...TZ}
      />,
    );
    expect(screen.getByText('Declined: Oven broke')).toBeOnTheScreen();
    expect(screen.queryByText(/Seller's note/)).toBeNull();
  });

  it("shows the seller's note on an accepted request", async () => {
    await render(
      <RequestRow
        request={accepted({ response_note: 'Please bring a bag' })}
        onPress={jest.fn()}
        {...TZ}
      />,
    );
    expect(screen.getByText("Seller's note: Please bring a bag")).toBeOnTheScreen();
    expect(screen.getByRole('button').props.accessibilityLabel).toContain(
      "Seller's note: Please bring a bag",
    );
  });

  it('shows no answer line, and speaks none, for a waiting request', async () => {
    await render(<RequestRow request={makeRequest()} onPress={jest.fn()} {...TZ} />);
    expect(screen.queryByText(/Declined:|Seller's note/)).toBeNull();
  });
});

describe('the seller list row', () => {
  it('shows the same words to the seller', async () => {
    const request: SellerRequest = makeSellerRequest({
      status: 'declined',
      display_status: 'declined',
      decline_reason: 'closed_then',
    });
    await render(<SellerRequestRow request={request} onPress={jest.fn()} {...TZ} />);
    expect(screen.getByText('Declined: Closed at that time')).toBeOnTheScreen();
    expect(screen.getByRole('button').props.accessibilityLabel).toContain(
      'Declined: Closed at that time',
    );
  });
});

describe('the customer request detail', () => {
  it('shows "Declined: <reason>" under the status', async () => {
    jest
      .mocked(getPickupRequest)
      .mockResolvedValue({ server_now: NOW, request: declined({ decline_reason: 'sold_out' }) });
    await renderScreen(<RequestDetailScreen requestId={REQUEST_ID} onBack={jest.fn()} {...TZ} />);
    expect(await screen.findByText('Declined: Sold out')).toBeOnTheScreen();
    expect(screen.getByText('Declined')).toBeOnTheScreen();
  });

  it("shows the seller's note, as text", async () => {
    jest.mocked(getPickupRequest).mockResolvedValue({
      server_now: NOW,
      request: accepted({ response_note: 'Please bring a bag <b>now</b> https://x.test' }),
    });
    await renderScreen(<RequestDetailScreen requestId={REQUEST_ID} onBack={jest.fn()} {...TZ} />);
    // Plain text: markup and links are shown as typed, not interpreted.
    expect(
      await screen.findByText("Seller's note: Please bring a bag <b>now</b> https://x.test"),
    ).toBeOnTheScreen();
  });

  it('never reads a waiting request as accepted or confirmed', async () => {
    jest.mocked(getPickupRequest).mockResolvedValue({ server_now: NOW, request: makeRequest() });
    await renderScreen(<RequestDetailScreen requestId={REQUEST_ID} onBack={jest.fn()} {...TZ} />);
    await screen.findByText("Joe's Pizza");
    expect(screen.queryByText(/Declined:|Seller's note/)).toBeNull();
    expect(screen.queryByText(/accepted|confirmed/i)).toBeNull();
  });
});

describe('the seller request detail', () => {
  it('shows the reason and the note the seller gave', async () => {
    jest.mocked(getBusinessRequest).mockResolvedValue({
      server_now: NOW,
      request: makeSellerRequest({
        status: 'declined',
        display_status: 'declined',
        decline_reason: 'other',
        response_note: 'Oven broke',
      }),
    });
    await renderScreen(
      <SellerRequestDetailScreen requestId={REQUEST_ID} onClose={jest.fn()} {...TZ} />,
    );
    expect(await screen.findByText('Declined: Oven broke')).toBeOnTheScreen();
  });
});
