import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCurrencies } from '@/features/menu/api';

import { REQUEST_ID } from '../__fixtures__/requests';
import { makeSellerRequest } from '../__fixtures__/sellerRequests';
import { RequestAppError, getBusinessRequest, markRequestOutcome, respondToRequest } from '../api';
import { SellerRequestDetailScreen } from '../components/SellerRequestDetailScreen';
import type { SellerRequest } from '../schema';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getBusinessRequest: jest.fn(),
  respondToRequest: jest.fn(),
  markRequestOutcome: jest.fn(),
}));

const getMock = jest.mocked(getBusinessRequest);
const respondMock = jest.mocked(respondToRequest);
const outcomeMock = jest.mocked(markRequestOutcome);
const onClose = jest.fn();

const SERVER_NOW = '2026-11-08T17:00:00Z';
const accepted = (over: Partial<SellerRequest> = {}) =>
  makeSellerRequest({ status: 'accepted', display_status: 'accepted', ...over });
const homemade = (over: Partial<SellerRequest> = {}) =>
  makeSellerRequest({ business_type: 'homemade', business_name: 'Nonna Rosa', ...over });

/** A tiny in-memory server for one request, so refetches after an action tell the truth. */
const state: { request: SellerRequest | null; now: string } = { request: null, now: SERVER_NOW };
const serve = (request: SellerRequest | null) => {
  state.request = request;
};

let client: QueryClient;
function renderScreen(requestId: string | null = REQUEST_ID, zone = 'Pacific/Auckland') {
  // gcTime Infinity: a mutation writes the answer into a cached request, and the tests read it back
  // while no component observes it (gcTime 0 would drop it at once).
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SellerRequestDetailScreen
          requestId={requestId}
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
  [getMock, respondMock, outcomeMock].forEach((mock) => mock.mockReset());
  state.now = SERVER_NOW;
  serve(makeSellerRequest());
  getMock.mockImplementation(async () => ({ server_now: state.now, request: state.request }));
  respondMock.mockImplementation(async (_id, decision) => {
    state.request = { ...state.request!, status: decision, display_status: decision };
    return state.request;
  });
  outcomeMock.mockImplementation(async (_id, outcome) => {
    state.request = { ...state.request!, status: outcome, display_status: outcome };
    return state.request;
  });
  jest
    .mocked(getCurrencies)
    .mockResolvedValue([{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }]);
});

afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
  client.clear();
});

const button = (name: RegExp | string) => screen.queryByRole('button', { name });

describe('states', () => {
  it('loading: a skeleton with a label', async () => {
    getMock.mockImplementation(() => new Promise(() => undefined));
    await renderScreen();
    expect(await screen.findByLabelText('Loading request')).toBeOnTheScreen();
  });

  it('error with Try again, then the request', async () => {
    getMock.mockRejectedValueOnce(new RequestAppError('network'));
    await renderScreen();
    expect(await screen.findByText(/No connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sam Rivera')).toBeOnTheScreen();
  });

  it('a request that is not theirs (or unknown) is one calm not-found with Close', async () => {
    serve(null);
    await renderScreen();
    expect(await screen.findByText("We couldn't find that request.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a bad link (no valid id) is the same calm not-found and reads nothing', async () => {
    await renderScreen(null);
    expect(await screen.findByText("We couldn't find that request.")).toBeOnTheScreen();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('a failed background refetch keeps the request on screen', async () => {
    await renderScreen();
    await screen.findByText('Sam Rivera');
    getMock.mockRejectedValue(new RequestAppError('network'));
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(screen.getByText('Sam Rivera')).toBeOnTheScreen();
  });
});

describe('what the seller sees', () => {
  it('the customer name, the status as a word, and the seller sentence', async () => {
    await renderScreen();
    expect(await screen.findByText('Sam Rivera')).toBeOnTheScreen();
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(screen.getByText('Waiting for your answer')).toBeOnTheScreen();
  });

  it('never shows anything private: no address, no email, no id', async () => {
    await renderScreen();
    await screen.findByText('Sam Rivera');
    expect(screen.queryByText(/@/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/address/i)).not.toBeOnTheScreen();
  });

  it('the items with quantities and prices, the estimated total, and who pays', async () => {
    serve(
      makeSellerRequest({
        items: [
          { item_id: 'i1', name: 'Margherita', unit_price_minor: 1250, quantity: 2 },
          { item_id: 'i2', name: 'Garlic bread', unit_price_minor: 500, quantity: 1 },
        ],
      }),
    );
    await renderScreen();
    expect(await screen.findByText('2 × Margherita')).toBeOnTheScreen();
    expect(screen.getByText('1 × Garlic bread')).toBeOnTheScreen();
    expect(screen.getByText(/25\.00/)).toBeOnTheScreen();
    expect(await screen.findByText(/Estimated total: .*30\.00/)).toBeOnTheScreen();
    expect(screen.getByText('Estimated total. The customer pays you directly.')).toBeOnTheScreen();
    expect(screen.queryByText('Total excludes items without a price')).not.toBeOnTheScreen();
  });

  it('says the total leaves out items without a price', async () => {
    serve(
      makeSellerRequest({
        items: [
          { item_id: 'i1', name: 'Margherita', unit_price_minor: 1250, quantity: 1 },
          { item_id: 'i2', name: 'Specials', unit_price_minor: null, quantity: 1 },
        ],
      }),
    );
    await renderScreen();
    expect(await screen.findByText('Total excludes items without a price')).toBeOnTheScreen();
  });

  it('shows a written order and the customer note', async () => {
    serve(makeSellerRequest({ items: null, order_text: 'Two jollof rice', note: 'Ring the bell' }));
    await renderScreen();
    expect(await screen.findByText('Two jollof rice')).toBeOnTheScreen();
    expect(screen.getByText('Customer note')).toBeOnTheScreen();
    expect(screen.getByText('Ring the bell')).toBeOnTheScreen();
  });

  it('no note, no note card', async () => {
    await renderScreen();
    await screen.findByText('Sam Rivera');
    expect(screen.queryByText('Customer note')).not.toBeOnTheScreen();
  });

  it('a pending request says when it expires', async () => {
    await renderScreen();
    expect(
      await screen.findByText(/If you don't answer by .*, this request expires\./),
    ).toBeOnTheScreen();
  });

  it('an answered request does not talk about expiring', async () => {
    serve(accepted());
    await renderScreen();
    await screen.findByText('You accepted this request');
    expect(screen.queryByText(/this request expires/)).not.toBeOnTheScreen();
  });

  it.each([
    ['Pacific/Auckland', '2026-11-08T17:00:00Z', /Mon, Nov 9, 6:00\s*AM/],
    ['Asia/Kathmandu', '2026-11-08T17:00:00Z', /Sun, Nov 8, 10:45\s*PM/],
    ['America/Toronto', '2026-11-08T17:00:00Z', /Sun, Nov 8, 12:00\s*PM/],
    // The clocks go forward in Toronto at 2:00 on 8 March: 06:30Z is 1:30 am, 07:30Z is 3:30 am.
    ['America/Toronto', '2026-03-08T06:30:00Z', /Sun, Mar 8, 1:30\s*AM/],
    ['America/Toronto', '2026-03-08T07:30:00Z', /Sun, Mar 8, 3:30\s*AM/],
    // …and back on 1 November: 05:30Z is 1:30 am EDT, 06:30Z is 1:30 am EST.
    ['America/Toronto', '2026-11-01T06:30:00Z', /Sun, Nov 1, 1:30\s*AM/],
  ])('shows the pickup time in %s for %s', async (zone, pickup, pattern) => {
    serve(makeSellerRequest({ pickup_at: pickup }));
    await renderScreen(REQUEST_ID, zone);
    await screen.findByText('Sam Rivera');
    expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);
  });

  it('caps the title at 1.6 times for large text', async () => {
    await renderScreen();
    expect((await screen.findByText('Sam Rivera')).props.maxFontSizeMultiplier).toBe(1.6);
  });
});

describe('which actions show', () => {
  const none = () => {
    for (const name of [/^Accept/, /^Decline/, /^Mark .* completed/, /^Mark .* no-show/]) {
      expect(button(name)).not.toBeOnTheScreen();
    }
  };

  it('pending: Accept and Decline, with labels that name the customer and the pickup time', async () => {
    await renderScreen();
    const accept = await screen.findByRole('button', {
      name: /^Accept request from Sam Rivera, pickup /,
    });
    expect(accept).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: /^Decline request from Sam Rivera, pickup / }),
    ).toBeOnTheScreen();
    expect(button(/completed|no-show/)).not.toBeOnTheScreen();
  });

  it('a pending request past its expiry (display_status expired) has no actions', async () => {
    serve(makeSellerRequest({ status: 'pending', display_status: 'expired' }));
    await renderScreen();
    expect(await screen.findByText('Expired')).toBeOnTheScreen();
    none();
  });

  it('accepted before the pickup time: no actions yet', async () => {
    serve(accepted({ pickup_at: '2026-11-08T18:00:00+00:00' }));
    await renderScreen();
    await screen.findByText('You accepted this request');
    none();
  });

  it('accepted after the pickup time: Mark completed and Mark no-show', async () => {
    serve(accepted({ pickup_at: '2026-11-08T16:30:00+00:00' }));
    await renderScreen();
    expect(
      await screen.findByRole('button', { name: /^Mark completed for request from Sam Rivera/ }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: /^Mark no-show for request from Sam Rivera/ }),
    ).toBeOnTheScreen();
    expect(button(/^Accept|^Decline/)).not.toBeOnTheScreen();
  });

  it.each(['declined', 'cancelled', 'completed', 'no_show', 'expired'] as const)(
    '%s is final: no actions',
    async (status) => {
      serve(
        makeSellerRequest({
          status,
          display_status: status,
          pickup_at: '2026-11-08T16:00:00+00:00',
        }),
      );
      await renderScreen();
      await screen.findByText('Sam Rivera');
      none();
    },
  );

  it('uses the seller wording for each final state', async () => {
    serve(makeSellerRequest({ status: 'declined', display_status: 'declined' }));
    await renderScreen();
    expect(await screen.findByText('You declined this request')).toBeOnTheScreen();
  });
});

describe('Accept and Decline: a confirm step', () => {
  it('Accept opens a confirm and sends nothing yet; Go back closes it', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    expect(screen.getByText('Accept this request?')).toBeOnTheScreen();
    expect(respondMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByText('Accept this request?')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Accept request/ })).toBeOnTheScreen();
  });

  it('the HOMEMADE Accept confirm says the exact address will be shown, for 24 hours after pickup', async () => {
    serve(homemade());
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    expect(
      screen.getByText(
        /Your exact address will be shown to the customer until 24 hours after the pickup time\./,
      ),
    ).toBeOnTheScreen();
  });

  it('the RESTAURANT Accept confirm does not mention an address', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    expect(screen.getByText('Accept this request?')).toBeOnTheScreen();
    expect(screen.queryByText(/address/i)).not.toBeOnTheScreen();
  });

  it('Decline never mentions an address, even for a homemade cook', async () => {
    serve(homemade());
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Decline request/ }));
    expect(screen.getByText('Decline this request?')).toBeOnTheScreen();
    expect(screen.queryByText(/address/i)).not.toBeOnTheScreen();
  });

  it('confirming Accept sends the request id and the decision only, then shows the seller wording', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
    expect(await screen.findByText('You accepted this request')).toBeOnTheScreen();
    expect(respondMock).toHaveBeenCalledTimes(1);
    expect(respondMock.mock.calls[0]).toEqual([REQUEST_ID, 'accepted']);
    expect(screen.getByText('Accepted')).toBeOnTheScreen();
    expect(button(/^Accept request/)).not.toBeOnTheScreen();
    expect(button(/^Decline request/)).not.toBeOnTheScreen();
    expect(screen.queryByText('Accept this request?')).not.toBeOnTheScreen();
  });

  it('confirming Decline sends the decision and the chosen reason, and shows Declined', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Decline request/ }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Sold out' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, decline request/ }));
    expect(await screen.findByText('You declined this request')).toBeOnTheScreen();
    expect(respondMock.mock.calls[0]).toEqual([
      REQUEST_ID,
      'declined',
      { declineReason: 'sold_out' },
    ]);
    expect(screen.getByText('Declined')).toBeOnTheScreen();
  });
});

describe('Completed and No-show: also confirmed, because they are final', () => {
  beforeEach(() => serve(accepted({ pickup_at: '2026-11-08T16:30:00+00:00' })));

  it('Mark completed asks first, then sends the outcome', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Mark completed/ }));
    expect(screen.getByText('Mark as completed?')).toBeOnTheScreen();
    expect(screen.getByText(/You can't undo this\./)).toBeOnTheScreen();
    expect(outcomeMock).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, mark completed/ }));
    expect(await screen.findByText('Pickup completed')).toBeOnTheScreen();
    expect(outcomeMock.mock.calls[0]).toEqual([REQUEST_ID, 'completed']);
  });

  it('Mark no-show asks first, then sends the outcome', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Mark no-show/ }));
    expect(screen.getByText('Mark as no-show?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, mark no-show/ }));
    expect(await screen.findByText('Marked as not picked up')).toBeOnTheScreen();
    expect(outcomeMock.mock.calls[0]).toEqual([REQUEST_ID, 'no_show']);
  });
});

describe('while an action runs, and when it goes wrong', () => {
  it('a double tap on the confirm sends one decision, and every button is disabled with progress', async () => {
    let finish: (r: SellerRequest) => void = () => undefined;
    respondMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    const confirm = screen.getByRole('button', { name: /^Yes, accept request/ });
    try {
      await fireEvent.press(confirm);
      await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
      await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
      expect(respondMock).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /^Yes, accept request/ }).props.accessibilityState,
        ).toEqual(expect.objectContaining({ disabled: true, busy: true })),
      );
      expect(screen.getByRole('button', { name: 'Go back' }).props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    } finally {
      await act(async () =>
        finish(makeSellerRequest({ status: 'accepted', display_status: 'accepted' })),
      );
    }
  });

  it('invalid_transition: a calm message, and the REAL status (cancelled meanwhile) is shown', async () => {
    respondMock.mockImplementation(async () => {
      state.request = makeSellerRequest({ status: 'cancelled', display_status: 'cancelled' });
      throw new RequestAppError('invalid_transition');
    });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
    // Each check asks the screen again until it is true. `expect(await findByText(..))` would hold
    // on to one element, and the refetch that follows the failure can replace it before the check.
    await waitFor(() =>
      expect(
        screen.getByText(/This request has changed .* Its current status is shown\./),
      ).toBeOnTheScreen(),
    );
    await waitFor(() =>
      expect(screen.getByText('The customer cancelled this request')).toBeOnTheScreen(),
    );
    expect(screen.getByText('Cancelled')).toBeOnTheScreen();
    expect(button(/^Accept request/)).not.toBeOnTheScreen();
    expect(screen.queryByText('Accepted')).not.toBeOnTheScreen();
  });

  it('a lost connection keeps the actions and says nothing was changed', async () => {
    respondMock.mockRejectedValue(new RequestAppError('network'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
    await waitFor(() => expect(screen.getByText(/Nothing was changed/)).toBeOnTheScreen());
    expect(screen.getByText('Waiting')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Accept request/ })).toBeOnTheScreen();
  });

  it('not_found: the request is gone, so it is the calm not-found', async () => {
    respondMock.mockImplementation(async () => {
      state.request = null;
      throw new RequestAppError('not_found');
    });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
    await waitFor(() =>
      expect(screen.getByText("We couldn't find that request.")).toBeOnTheScreen(),
    );
  });
});

describe('the clock: the server decides, the phone is a hint', () => {
  it('a phone 2 h AHEAD does not show Completed / No-show before the server-side pickup time', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T19:00:00Z') });
    serve(accepted({ pickup_at: '2026-11-08T17:30:00+00:00' }));
    await renderScreen();
    await screen.findByText('You accepted this request');
    expect(button(/^Mark/)).not.toBeOnTheScreen();
  });

  it('…and shows them by itself when the server-side pickup time arrives', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T19:00:00Z') });
    serve(accepted({ pickup_at: '2026-11-08T17:30:00+00:00' }));
    await renderScreen();
    await screen.findByText('You accepted this request');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(31 * 60_000);
    });
    expect(await screen.findByRole('button', { name: /^Mark completed/ })).toBeOnTheScreen();
  });

  it('a phone 2 h BEHIND still shows them once the server clock says the time has passed', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T15:00:00Z') });
    serve(accepted({ pickup_at: '2026-11-08T16:30:00+00:00' }));
    await renderScreen();
    expect(await screen.findByRole('button', { name: /^Mark completed/ })).toBeOnTheScreen();
  });

  it('if the hint is wrong the server refuses calmly, and the real status stays on screen', async () => {
    serve(accepted({ pickup_at: '2026-11-08T16:30:00+00:00' }));
    outcomeMock.mockRejectedValue(new RequestAppError('invalid_transition'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Mark completed/ }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, mark completed/ }));
    expect(await screen.findByText(/This request has changed/)).toBeOnTheScreen();
    expect(screen.getByText('Accepted')).toBeOnTheScreen();
  });

  it('a wrong phone clock never changes a displayed status', async () => {
    jest.useFakeTimers({ now: new Date('2031-01-01T00:00:00Z') });
    await renderScreen();
    expect(await screen.findByText('Waiting')).toBeOnTheScreen();
    expect(screen.queryByText('Expired')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Accept request/ })).toBeOnTheScreen();
  });

  it('a pending request that expires before the cron runs turns Expired, with no actions', async () => {
    jest.useFakeTimers({ now: new Date(SERVER_NOW) });
    serve(makeSellerRequest({ expires_at: '2026-11-08T17:00:20+00:00' }));
    await renderScreen();
    expect(await screen.findByText('Waiting')).toBeOnTheScreen();
    // The server's next answer: past expires_at, the stored status still pending.
    state.now = '2026-11-08T17:00:25Z';
    state.request = { ...state.request!, display_status: 'expired' };
    await act(async () => {
      await jest.advanceTimersByTimeAsync(22_000);
    });
    expect(await screen.findByText('Expired')).toBeOnTheScreen();
    expect(screen.getByText('This request expired before you answered')).toBeOnTheScreen();
    expect(button(/^Accept request/)).not.toBeOnTheScreen();
    expect(button(/^Decline request/)).not.toBeOnTheScreen();
  });
});
