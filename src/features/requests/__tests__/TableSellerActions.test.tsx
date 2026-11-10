import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { markRequestOutcome, respondToRequest, RequestAppError } from '../api';
import { RequestActions } from '../components/RequestActions';
import type { BusinessRequest } from '../schema';

import { makeSellerTableRequest, TABLE_REQUEST_ID } from '../__fixtures__/tableRequests';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  respondToRequest: jest.fn(),
  markRequestOutcome: jest.fn(),
}));

const respondMock = jest.mocked(respondToRequest);
const outcomeMock = jest.mocked(markRequestOutcome);
const TZ = { timeZone: 'America/Toronto', locale: 'en-US' };
const accepted = (over = {}) =>
  makeSellerTableRequest({ status: 'accepted', display_status: 'accepted', ...over });

let client: QueryClient;
async function renderActions(request: BusinessRequest = makeSellerTableRequest(), passed = false) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RequestActions request={request} pickupPassed={passed} {...TZ} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  respondMock.mockReset();
  outcomeMock.mockReset();
  respondMock.mockImplementation(async (_id, decision) =>
    makeSellerTableRequest({ status: decision, display_status: decision }),
  );
  outcomeMock.mockImplementation(async (_id, outcome) =>
    makeSellerTableRequest({ status: outcome, display_status: outcome }),
  );
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

const open = (name: RegExp) => screen.findByRole('button', { name });
const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  el.props.accessibilityState?.disabled === true;

describe('a pending table request', () => {
  it('offers Accept and Decline, spoken with the table time, not a pickup', async () => {
    await renderActions();
    expect(
      await open(/^Accept request from Sam Rivera, table Sun, Nov 8, 7:00 PM$/),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: /^Decline request from Sam Rivera, table/ }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Mark completed/ })).not.toBeOnTheScreen();
  });

  it('Accept with no note sends the table kind and no words', async () => {
    await renderActions();
    await fireEvent.press(await open(/^Accept request/));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock).toHaveBeenCalledWith(TABLE_REQUEST_ID, 'accepted', {}, 'table');
  });

  it('Accept with a note sends the note', async () => {
    await renderActions();
    await fireEvent.press(await open(/^Accept request/));
    await fireEvent.changeText(
      screen.getByLabelText('Note for the customer (optional)'),
      '  See you at the bar  ',
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, accept request/ }));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock).toHaveBeenCalledWith(
      TABLE_REQUEST_ID,
      'accepted',
      { note: 'See you at the bar' },
      'table',
    );
  });

  it('Accept never mentions an address (a table has none)', async () => {
    await renderActions();
    await fireEvent.press(await open(/^Accept request/));
    expect(screen.queryByText(/exact address/i)).not.toBeOnTheScreen();
    expect(screen.getByText(/The customer will see that you accepted it/)).toBeOnTheScreen();
  });
});

describe('Decline offers the five table reasons', () => {
  it('lists them in order, with no pickup-only reason', async () => {
    await renderActions();
    await fireEvent.press(await open(/^Decline request/));
    const radios = screen.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel);
    expect(radios).toEqual([
      'Fully booked',
      'Closed at that time',
      'Too busy right now',
      "Time doesn't work",
      'Other',
    ]);
    expect(screen.queryByRole('radio', { name: 'Sold out' })).not.toBeOnTheScreen();
  });

  it('Decline waits for a reason: the confirm is off until one is chosen', async () => {
    await renderActions();
    await fireEvent.press(await open(/^Decline request/));
    const confirm = screen.getByRole('button', { name: /^Yes, decline request/ });
    expect(isDisabled(confirm)).toBe(true);
    expect(screen.getByText('Choose a reason first')).toBeOnTheScreen();
  });

  it.each([
    ['Fully booked', 'fully_booked'],
    ['Closed at that time', 'closed_then'],
    ['Too busy right now', 'too_busy'],
    ["Time doesn't work", 'time_not_possible'],
  ])('%s sends the reason and no words', async (label, code) => {
    await renderActions();
    await fireEvent.press(await open(/^Decline request/));
    await fireEvent.press(screen.getByRole('radio', { name: label }));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, decline request/ }));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock).toHaveBeenCalledWith(
      TABLE_REQUEST_ID,
      'declined',
      { declineReason: code },
      'table',
    );
  });

  it("Other needs the restaurant's own words", async () => {
    await renderActions();
    await fireEvent.press(await open(/^Decline request/));
    await fireEvent.press(screen.getByRole('radio', { name: 'Other' }));
    const confirm = screen.getByRole('button', { name: /^Yes, decline request/ });
    expect(isDisabled(confirm)).toBe(true);
    expect(screen.getByText('Write your reason first')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Your reason'), 'Private party');
    expect(isDisabled(screen.getByRole('button', { name: /^Yes, decline request/ }))).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, decline request/ }));
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1));
    expect(respondMock).toHaveBeenCalledWith(
      TABLE_REQUEST_ID,
      'declined',
      { declineReason: 'other', note: 'Private party' },
      'table',
    );
  });

  it('a double tap on the confirm sends one decision', async () => {
    let finish: (r: BusinessRequest) => void = () => undefined;
    respondMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderActions();
    await fireEvent.press(await open(/^Decline request/));
    await fireEvent.press(screen.getByRole('radio', { name: 'Fully booked' }));
    const confirm = screen.getByRole('button', { name: /^Yes, decline request/ });
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    expect(respondMock).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish(makeSellerTableRequest({ status: 'declined', display_status: 'declined' })),
    );
  });
});

describe('Completed and No-show', () => {
  it('only on an accepted request, and only once the table time has passed (server clock)', async () => {
    await renderActions(accepted(), false);
    expect(screen.queryByRole('button', { name: /Mark completed/ })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Mark no-show/ })).not.toBeOnTheScreen();
    await cleanup();
    await renderActions(accepted(), true);
    expect(await open(/^Mark completed for request from Sam Rivera, table/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Mark no-show for request/ })).toBeOnTheScreen();
  });

  it.each(['pending', 'declined', 'expired', 'cancelled', 'completed', 'no_show'] as const)(
    'never on a %s request, even after the table time',
    async (status) => {
      await renderActions(makeSellerTableRequest({ status, display_status: status }), true);
      expect(screen.queryByRole('button', { name: /Mark completed/ })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: /Mark no-show/ })).not.toBeOnTheScreen();
    },
  );

  it('asks first, in table words, then sends the table kind once on a double tap', async () => {
    let finish: (r: BusinessRequest) => void = () => undefined;
    outcomeMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderActions(accepted(), true);
    await fireEvent.press(await open(/^Mark no-show/));
    expect(screen.getByText(/did not come for their table/)).toBeOnTheScreen();
    const yes = screen.getByRole('button', { name: /^Yes, mark no-show/ });
    await fireEvent.press(yes);
    await fireEvent.press(yes);
    expect(outcomeMock).toHaveBeenCalledTimes(1);
    expect(outcomeMock).toHaveBeenCalledWith(TABLE_REQUEST_ID, 'no_show', 'table');
    await act(async () =>
      finish(makeSellerTableRequest({ status: 'no_show', display_status: 'no_show' })),
    );
  });

  it('a refused outcome says so', async () => {
    outcomeMock.mockRejectedValue(new RequestAppError('invalid_transition'));
    await renderActions(accepted(), true);
    await fireEvent.press(await open(/^Mark completed/));
    await fireEvent.press(screen.getByRole('button', { name: /^Yes, mark completed/ }));
    expect(await screen.findByText(/This request has changed/)).toBeOnTheScreen();
  });
});
