import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fetchRestaurantDetails } from '@/features/map/api';
import { peekReturnTo, setReturnTo, tableRequestFormHref } from '@/features/auth/returnTo';

import { dump } from '../__fixtures__/dump';
import { BUSINESS_ID } from '../__fixtures__/requests';
import { makeTableRequest } from '../__fixtures__/tableRequests';
import { RequestAppError, submitTableRequest } from '../api';
import { TableRequestScreen } from '../components/TableRequestScreen';

jest.setTimeout(15_000);

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/map/api', () => ({
  ...jest.requireActual('@/features/map/api'),
  fetchRestaurantDetails: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  submitTableRequest: jest.fn(),
}));
// KeyboardAvoidingView renders a plain View that keeps the props the form gave it.
jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createElement } = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const KeyboardAvoidingView = (props: { children?: unknown }) =>
    createElement(View, { testID: 'keyboard-avoiding', ...props });
  return { __esModule: true, default: KeyboardAvoidingView };
});
// ScrollView renders a plain View that keeps its props, and its ref exposes one shared scrollTo.
const mockScrollTo = jest.fn();
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const ScrollView = React.forwardRef(function MockScrollView(
    props: { children?: unknown },
    ref: unknown,
  ) {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
    return React.createElement(View, props, props.children);
  });
  return { __esModule: true, default: ScrollView };
});

const submitMock = jest.mocked(submitTableRequest);
const restaurantMock = jest.mocked(fetchRestaurantDetails);

const restaurant = (over: object = {}) => ({
  id: BUSINESS_ID,
  name: "Luigi's",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  public_address: '1 King St',
  place_id: 'FAKE_PLACE',
  currency_code: 'CAD' as string | null,
  photos: [],
  items: [],
  ...over,
});

const onClose = jest.fn();
let client: QueryClient;

function renderScreen(
  businessId: string | null = BUSINESS_ID,
  zone: { timeZone?: string; locale?: string } = { timeZone: 'America/Toronto', locale: 'en-US' },
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
        <TableRequestScreen businessId={businessId} onClose={onClose} {...zone} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

async function formReady() {
  await screen.findByRole('header', { name: 'Request table' });
}

// Opens the table-time dialog and taps Done: with the control untouched that chooses the earliest
// allowed time (30 minutes plus slack, rounded up to a quarter hour).
async function pickFirstTime() {
  await fireEvent.press(screen.getByRole('button', { name: 'Choose table time' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done, use this table time' }));
}

const send = () => screen.getByRole('button', { name: "Send table request to Luigi's" });

beforeEach(() => {
  jest.clearAllMocks();
  mockScrollTo.mockClear();
  submitMock.mockReset();
  restaurantMock.mockReset();
  restaurantMock.mockResolvedValue(restaurant());
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('the four states', () => {
  it('loading: one spoken label', async () => {
    restaurantMock.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    expect(screen.getByLabelText('Loading restaurant')).toBeOnTheScreen();
  });

  it('a restaurant that does not take tables: one calm "not available", no form', async () => {
    restaurantMock.mockResolvedValue(restaurant({ accepts_table_requests: false }));
    await renderScreen();
    expect(await screen.findByText("This place isn't available right now.")).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Request table' })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('not a listed restaurant (a homemade seller or an unknown id), or a bad link: the same answer', async () => {
    restaurantMock.mockResolvedValue(null);
    await renderScreen();
    expect(await screen.findByText("This place isn't available right now.")).toBeOnTheScreen();
    await cleanup();
    client.clear();
    restaurantMock.mockClear();
    await renderScreen(null);
    expect(screen.getByText("This place isn't available right now.")).toBeOnTheScreen();
    expect(restaurantMock).not.toHaveBeenCalled();
  });

  it('error: Retry loads it again', async () => {
    restaurantMock.mockRejectedValue(new Error('offline'));
    await renderScreen();
    // The lookup is tried once more on its own before the error shows.
    await screen.findByText("We couldn't load this restaurant. Try again.", {}, { timeout: 4000 });
    restaurantMock.mockResolvedValue(restaurant());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await formReady();
  });

  it('success: the form, with the sign-in return used up', async () => {
    setReturnTo(tableRequestFormHref(BUSINESS_ID));
    await renderScreen();
    await formReady();
    expect(screen.getByText("At Luigi's")).toBeOnTheScreen();
    expect(peekReturnTo()).toBeNull();
  });
});

describe('the form', () => {
  it('asks for a time first: Send without one says so and sends nothing', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(send());
    expect(await screen.findByText('Choose a table time')).toBeOnTheScreen();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('sends the chosen time, the party of 2 it starts with, and no note', async () => {
    submitMock.mockResolvedValue(makeTableRequest());
    await renderScreen();
    await formReady();
    await pickFirstTime();
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const [input] = submitMock.mock.calls[0];
    expect(input).toMatchObject({ businessId: BUSINESS_ID, partySize: 2, note: undefined });
    expect(input.tableAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(input.tableAt.getUTCMinutes() % 15).toBe(0);
  });

  it('the party goes up and down between 1 and 20 and never outside', async () => {
    submitMock.mockResolvedValue(makeTableRequest());
    await renderScreen();
    await formReady();
    // Down to 1: the decrease button is then off, so the party can never reach 0.
    await fireEvent.press(screen.getByRole('button', { name: 'Fewer people, now 2 people' }));
    expect(screen.getByLabelText('Party of 1')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Fewer people, now 1 person' })).toBeDisabled();
    // Up to 20: the increase button is then off, so the party can never reach 21.
    for (let size = 1; size < 20; size += 1) {
      await fireEvent.press(screen.getByRole('button', { name: /^More people/ }));
    }
    expect(screen.getByLabelText('Party of 20')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'More people, now 20 people' })).toBeDisabled();

    await pickFirstTime();
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0][0].partySize).toBe(20);
  });

  it('cleans the note of hidden characters and sends it trimmed', async () => {
    submitMock.mockResolvedValue(makeTableRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(
      screen.getByLabelText('Note for the restaurant (optional)'),
      '  window\u200B seat  ',
    );
    await pickFirstTime();
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0][0].note).toBe('window seat');
  });

  it('a double tap on Send sends one request', async () => {
    let finish: (value: ReturnType<typeof makeTableRequest>) => void = () => undefined;
    submitMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderScreen();
    await formReady();
    await pickFirstTime();
    await fireEvent.press(send());
    await fireEvent.press(send());
    expect(submitMock).toHaveBeenCalledTimes(1);
    await act(async () => finish(makeTableRequest()));
    await screen.findByRole('header', { name: 'Request sent' });
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the form and says what went wrong when the server refuses', async () => {
    submitMock.mockRejectedValue(new RequestAppError('invalid_table_time'));
    await renderScreen();
    await formReady();
    await pickFirstTime();
    await fireEvent.press(send());
    expect(
      await screen.findByText('Pick a table time between 30 minutes and 30 days from now.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Request table' })).toBeOnTheScreen();
  });

  it('after a send: waiting, never accepted or confirmed, with the table time and its zone', async () => {
    submitMock.mockResolvedValue(makeTableRequest({ party_size: 4 }));
    await renderScreen();
    await formReady();
    await pickFirstTime();
    await fireEvent.press(send());
    await screen.findByRole('header', { name: 'Request sent' });
    expect(screen.getByText("Table request waiting for Luigi's.")).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: Waiting')).toBeOnTheScreen();
    expect(dump()).not.toMatch(/accepted|confirm|booked/i);
    // 2026-11-09 00:00 UTC is 7:00 PM EST in Toronto.
    expect(screen.getByText(/Sun, Nov 8, 7:00 PM EST, party of 4\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'View my requests' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/requests');
  });
});

describe('the table time is shown with its zone name (explicit-zone tests)', () => {
  it('the sent summary names the zone it was given, for the same instant', async () => {
    submitMock.mockResolvedValue(makeTableRequest({ table_at: '2026-11-09T00:00:00+00:00' }));
    await renderScreen(BUSINESS_ID, { timeZone: 'Pacific/Auckland', locale: 'en-US' });
    await formReady();
    await pickFirstTime();
    await fireEvent.press(send());
    await screen.findByRole('header', { name: 'Request sent' });
    // The same UTC instant, in Auckland: 1:00 PM the next day, with Auckland's zone name.
    expect(screen.getByText(/Mon, Nov 9, 1:00 PM \S+, party of 4\./)).toBeOnTheScreen();
    expect(screen.queryByText(/EST/)).not.toBeOnTheScreen();
  });

  it('the picked time on the form carries a zone name', async () => {
    await renderScreen();
    await formReady();
    await pickFirstTime();
    expect(screen.getByText(/^Table time: .+ (EST|EDT)$/)).toBeOnTheScreen();
  });
});
