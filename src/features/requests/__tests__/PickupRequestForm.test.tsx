import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCurrencies } from '@/features/menu/api';
import { fetchHomemadeDetails, fetchRestaurantDetails } from '@/features/map/api';
import type { DetailsItem } from '@/features/map/schema';
import { peekReturnTo, requestFormHref, setReturnTo } from '@/features/auth/returnTo';

import { BUSINESS_ID, makeRequest } from '../__fixtures__/requests';
import { RequestAppError, submitPickupRequest } from '../api';
import { NewRequestScreen } from '../components/NewRequestScreen';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn(),
}));
jest.mock('@/features/map/api', () => ({
  ...jest.requireActual('@/features/map/api'),
  fetchRestaurantDetails: jest.fn(),
  fetchHomemadeDetails: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  submitPickupRequest: jest.fn(),
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

const submitMock = jest.mocked(submitPickupRequest);
const restaurantMock = jest.mocked(fetchRestaurantDetails);
const homemadeMock = jest.mocked(fetchHomemadeDetails);

const item = (over: Partial<DetailsItem> & Pick<DetailsItem, 'id' | 'name'>): DetailsItem => ({
  description: null,
  price_minor: 1000,
  is_available: true,
  position: 1,
  ...over,
});
const items: DetailsItem[] = [
  item({ id: 'a', name: 'Margherita', price_minor: 1250, position: 1 }),
  item({ id: 'b', name: 'House salad', price_minor: null, position: 2 }),
  item({ id: 'c', name: 'Cheesecake', price_minor: 600, is_available: false, position: 3 }),
];
const restaurant = (over: object = {}) => ({
  id: BUSINESS_ID,
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: false,
  public_address: '1 King St',
  place_id: 'FAKE_PLACE',
  currency_code: 'CAD' as string | null,
  photos: [],
  items,
  ...over,
});

const onClose = jest.fn();
let client: QueryClient;

function renderScreen(businessId: string | null = BUSINESS_ID) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <NewRequestScreen businessId={businessId} onClose={onClose} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

async function formReady() {
  await screen.findByRole('header', { name: 'Request pickup' });
}

// The first time button on offer (the day starts on today, and the earliest slot is valid).
async function pickFirstTime() {
  const slot = screen
    .getAllByRole('button')
    .find((button) => /, \d{1,2}:\d{2}/.test(button.props.accessibilityLabel ?? ''));
  if (!slot) throw new Error('no time slot');
  await fireEvent.press(slot);
}

const send = () => screen.getByRole('button', { name: "Send pickup request to Joe's Pizza" });

beforeEach(() => {
  jest.clearAllMocks();
  mockScrollTo.mockClear();
  submitMock.mockReset();
  restaurantMock.mockResolvedValue(restaurant());
  homemadeMock.mockResolvedValue(null);
  jest
    .mocked(getCurrencies)
    .mockResolvedValue([{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }]);
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('states', () => {
  it('shows a loading menu, then the form', async () => {
    await renderScreen();
    expect(screen.getByLabelText('Loading menu')).toBeOnTheScreen();
    await formReady();
    expect(screen.queryByLabelText('Loading menu')).not.toBeOnTheScreen();
  });

  it('says "not available" calmly for an unknown, hidden or bad-link business', async () => {
    restaurantMock.mockResolvedValue(null);
    await renderScreen();
    expect(await screen.findByText("This place isn't available right now.")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Send pickup request/ })).not.toBeOnTheScreen();
    expect(homemadeMock).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it('a link without a valid id never asks the server', async () => {
    await renderScreen(null);
    expect(screen.getByText("This place isn't available right now.")).toBeOnTheScreen();
    expect(restaurantMock).not.toHaveBeenCalled();
    expect(homemadeMock).not.toHaveBeenCalled();
  });

  it('shows an error with Retry, and Retry reloads', async () => {
    restaurantMock.mockRejectedValue(new Error('boom'));
    await renderScreen();
    // The details hook retries a failed lookup once, after a short wait.
    expect(
      await screen.findByText("We couldn't load this menu. Try again.", {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    restaurantMock.mockResolvedValue(restaurant());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await formReady();
  });

  it('falls back to a homemade cook when the id is not a restaurant', async () => {
    restaurantMock.mockResolvedValue(null);
    homemadeMock.mockResolvedValue({
      id: BUSINESS_ID,
      name: 'Nonna Rosa',
      cuisine_code: 'IT',
      currency_code: 'CAD',
      photos: [],
      items,
    });
    await renderScreen();
    expect(await screen.findByText('From Nonna Rosa')).toBeOnTheScreen();
  });

  it('Back leaves the form', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the map' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opening the form uses up the sign-in return', async () => {
    setReturnTo(requestFormHref(BUSINESS_ID));
    await renderScreen();
    await formReady();
    expect(peekReturnTo()).toBeNull();
  });
});

describe('menu and summary', () => {
  it('lists only available items, with steppers labelled with the count', async () => {
    await renderScreen();
    await formReady();
    expect(screen.getByText('Margherita')).toBeOnTheScreen();
    expect(screen.getByText('House salad')).toBeOnTheScreen();
    expect(screen.queryByText('Cheesecake')).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    ).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    expect(
      screen.getByRole('button', { name: 'Decrease Margherita quantity, now 1' }),
    ).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Decrease Margherita quantity, now 1' }),
    );
    expect(screen.getByRole('button', { name: 'Decrease Margherita quantity, now 0' })).toHaveProp(
      'accessibilityState',
      { disabled: true },
    );
  });

  it('stops at 20 per item', async () => {
    await renderScreen();
    await formReady();
    for (let n = 0; n < 20; n += 1) {
      await fireEvent.press(
        screen.getByRole('button', { name: `Increase Margherita quantity, now ${n}` }),
      );
    }
    expect(screen.getByRole('button', { name: 'Increase Margherita quantity, now 20' })).toHaveProp(
      'accessibilityState',
      { disabled: true },
    );
  });

  it('shows the total with the currency format, and the pay-the-seller note', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 1' }),
    );
    expect(await screen.findByText('Estimated total: CA$25.00')).toBeOnTheScreen();
    expect(screen.getByText('Estimated total. Pay the seller directly.')).toBeOnTheScreen();
    expect(screen.queryByText('Total excludes items without a price')).not.toBeOnTheScreen();
  });

  it('says the total excludes items without a price', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase House salad quantity, now 0' }),
    );
    expect(await screen.findByText('Total excludes items without a price')).toBeOnTheScreen();
    expect(screen.getByText('Estimated total: CA$12.50')).toBeOnTheScreen();
  });

  it('shows no currency symbol and no total when the business has no currency', async () => {
    restaurantMock.mockResolvedValue(restaurant({ currency_code: null }));
    await renderScreen();
    await formReady();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    expect(screen.getByText('1 × Margherita')).toBeOnTheScreen();
    expect(screen.queryByText(/Estimated total:/)).not.toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/[$€£¥]/);
  });

  it('with no available items, asks for a free-text order', async () => {
    restaurantMock.mockResolvedValue(
      restaurant({ items: [item({ id: 'c', name: 'Cheesecake', is_available: false })] }),
    );
    await renderScreen();
    await formReady();
    expect(
      screen.getByText("No menu items available. Describe what you'd like."),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Your order')).toBeOnTheScreen();
  });
});

describe('keyboard', () => {
  it('pads the form on iOS and keeps taps working while the keyboard is up', async () => {
    await renderScreen();
    await formReady();
    expect(screen.getByTestId('keyboard-avoiding')).toHaveProp('behavior', 'padding');
    expect(screen.getByTestId('request-form-scroll')).toHaveProp(
      'keyboardShouldPersistTaps',
      'handled',
    );
  });
});

describe('keyboard: focus scrolls the field into view', () => {
  it.each(['Anything else', 'Note for the seller (optional)'])('%s', async (label) => {
    await renderScreen();
    await formReady();
    mockScrollTo.mockClear();
    await fireEvent(screen.getByLabelText(label), 'focus');
    expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
  });
});

describe('sending', () => {
  it('sends ids and quantities only, with the picked time and a key', async () => {
    submitMock.mockResolvedValue(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 1' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'extra napkins');
    await fireEvent.changeText(
      screen.getByLabelText('Note for the seller (optional)'),
      'ring bell',
    );
    await pickFirstTime();
    await fireEvent.press(send());

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const input = submitMock.mock.calls[0][0];
    expect(input).toMatchObject({
      businessId: BUSINESS_ID,
      items: [{ itemId: 'a', quantity: 2 }],
      orderText: 'extra napkins',
      note: 'ring bell',
    });
    expect(input.pickupAt).toBeInstanceOf(Date);
    expect(input.idempotencyKey).toBe(jest.mocked(randomUUID).mock.results.at(-1)?.value);
    expect(JSON.stringify(input)).not.toMatch(/price|status|name/i);
  });

  it('sends a free-text-only order', async () => {
    submitMock.mockResolvedValue(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0][0]).toMatchObject({
      items: undefined,
      orderText: 'two pizzas',
    });
  });

  it('strips hidden characters as they are typed and before sending', async () => {
    submitMock.mockResolvedValue(makeRequest());
    await renderScreen();
    await formReady();
    const field = screen.getByLabelText('Anything else');
    await fireEvent.changeText(
      field,
      `two${String.fromCodePoint(0x200b)} pi${String.fromCodePoint(0x202e)}zzas`,
    );
    expect(screen.getByLabelText('Anything else')).toHaveProp('value', 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0][0].orderText).toBe('two pizzas');
  });

  it('asks for a time, and for an order, before sending anything', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(send());
    expect(await screen.findByText('Choose a pickup time')).toBeOnTheScreen();
    await pickFirstTime();
    await fireEvent.press(send());
    expect(
      await screen.findByText('Choose an item or describe what you’d like.'),
    ).toBeOnTheScreen();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('shows "Pick a later time" when the server says the time is invalid, and keeps the form filled', async () => {
    submitMock.mockRejectedValue(new RequestAppError('invalid_pickup_time'));
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    expect(await screen.findByText(/Pick a later time/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Anything else')).toHaveProp('value', 'two pizzas');
  });

  it.each([
    ['too_many_pending', /already have a request waiting/],
    ['rate_limited', /Try again later/],
    ['business_unavailable', /isn't available right now/],
    ['item_unavailable', /no longer available/],
    ['network', /No connection/],
  ] as const)('explains %s', async (code, message) => {
    submitMock.mockRejectedValue(new RequestAppError(code));
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it('a double tap sends one request, and Send is disabled while it runs', async () => {
    let finish: (value: ReturnType<typeof makeRequest>) => void = () => undefined;
    submitMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    await fireEvent.press(send());
    expect(submitMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(send()).toHaveProp('accessibilityState', { disabled: true, busy: true }),
    );
    finish(makeRequest());
    expect(await screen.findByText('Request sent')).toBeOnTheScreen();
  });

  it('retries the same order with the same key', async () => {
    submitMock
      .mockRejectedValueOnce(new RequestAppError('network'))
      .mockResolvedValueOnce(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    await screen.findByText(/No connection/);
    await fireEvent.press(send());
    await screen.findByText('Request sent');
    const [first, second] = submitMock.mock.calls.map(([input]) => input.idempotencyKey);
    expect(second).toBe(first);
  });

  it('shows "Request sent. Waiting for <seller>", never confirmed', async () => {
    submitMock.mockResolvedValue(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    expect(await screen.findByText('Request sent')).toBeOnTheScreen();
    expect(screen.getByText("Waiting for Joe's Pizza to respond.")).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: Waiting')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/confirm|booked|on its way/i);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
