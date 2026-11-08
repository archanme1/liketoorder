import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCurrencies } from '@/features/menu/api';
import { fetchHomemadeDetails, fetchRestaurantDetails } from '@/features/map/api';
import type { DetailsItem } from '@/features/map/schema';
import { peekReturnTo, requestFormHref, setReturnTo } from '@/features/auth/returnTo';

import { dump } from '../__fixtures__/dump';
import { BUSINESS_ID, makeRequest } from '../__fixtures__/requests';
import { RequestAppError, submitPickupRequest } from '../api';
import { NewRequestScreen } from '../components/NewRequestScreen';

// The first test of this suite pays the cold cost of loading the whole form (react-native, the
// query client, the native-module fakes). That takes ~0.3 s here but went past jest's 5 s default
// on a loaded CI runner (the suite took 17 s there), so give every test in this file more room.
jest.setTimeout(15_000);

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
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

// Opens the pickup-time dialog and taps Done: with the control untouched that chooses the
// earliest allowed time.
async function pickFirstTime() {
  await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
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
      await screen.findByText("Choose an item or describe what you'd like."),
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
    await fireEvent.press(screen.getByRole('button', { name: 'View my requests' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/requests');
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('the fixed Send bar', () => {
  const sendName = "Send pickup request to Joe's Pizza";

  it('the total is a value, not a heading', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    await screen.findByText('Estimated total: CA$12.50');
    expect(screen.queryByRole('header', { name: /Estimated total/ })).not.toBeOnTheScreen();
  });

  it('sits above the scrolling form, not inside it', async () => {
    await renderScreen();
    await formReady();
    const scroll = screen.getByTestId('request-form-scroll');
    expect(within(scroll).queryByRole('button', { name: sendName })).not.toBeOnTheScreen();
    expect(
      within(screen.getByTestId('send-bar')).getByRole('button', { name: sendName }),
    ).toBeOnTheScreen();
    const tree = dump();
    expect(tree.indexOf('"testID":"send-bar"')).toBeGreaterThan(-1);
    expect(tree.indexOf('"testID":"send-bar"')).toBeLessThan(
      tree.indexOf('"testID":"request-form-scroll"'),
    );
    // Right under the title, close to the business name.
    expect(tree.indexOf('From Joe')).toBeLessThan(tree.indexOf('"testID":"send-bar"'));
  });

  it('shows the estimated total beside Send, and the unpriced rule under it', async () => {
    await renderScreen();
    await formReady();
    const bar = () => within(screen.getByTestId('send-bar'));
    expect(bar().queryByText(/Estimated total/)).not.toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 1' }),
    );
    expect(await bar().findByText('Estimated total: CA$25.00')).toBeOnTheScreen();
    expect(bar().queryByText('Total excludes items without a price')).not.toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase House salad quantity, now 0' }),
    );
    expect(await bar().findByText('Total excludes items without a price')).toBeOnTheScreen();
    // The total is said once: the order card keeps the lines and the pay-the-seller note.
    expect(screen.getAllByText(/Estimated total:/)).toHaveLength(1);
    expect(screen.getByText('Estimated total. Pay the seller directly.')).toBeOnTheScreen();
  });

  it('shows problems in the bar, right under Send, and scrolls to the time section', async () => {
    await renderScreen();
    await formReady();
    mockScrollTo.mockClear();
    await fireEvent.press(send());
    const bar = within(screen.getByTestId('send-bar'));
    expect(await bar.findByText('Choose a pickup time')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('request-form-scroll')).queryByText('Choose a pickup time'),
    ).not.toBeOnTheScreen();
    expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
  });

  it('shows a server problem in the bar too', async () => {
    submitMock.mockRejectedValue(new RequestAppError('rate_limited'));
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    expect(
      await within(screen.getByTestId('send-bar')).findByText(/Try again later/),
    ).toBeOnTheScreen();
  });

  it('has no fixed height and wraps, so large text never clips it', async () => {
    await renderScreen();
    await formReady();
    const flat = (node: { props: { style?: unknown } }) =>
      Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    const bar = screen.getByTestId('send-bar');
    expect(flat(bar).height).toBeUndefined();
    expect(flat(bar).maxHeight).toBeUndefined();
    const row = bar.children[0] as unknown as { props: { style?: unknown } };
    expect(flat(row).flexWrap).toBe('wrap');
    const button = screen.getByRole('button', { name: sendName });
    expect(flat(button).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(button).height).toBeUndefined();
  });

  it('is disabled and busy while sending, and a double tap sends one request', async () => {
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
      expect(
        within(screen.getByTestId('send-bar')).getByRole('button', { name: sendName }),
      ).toHaveProp('accessibilityState', { disabled: true, busy: true }),
    );
    finish(makeRequest());
    expect(await screen.findByText('Request sent')).toBeOnTheScreen();
    expect(screen.queryByTestId('send-bar')).not.toBeOnTheScreen();
  });
});

describe('the title steps aside while the keyboard is up', () => {
  function captureKeyboard() {
    // Both the screen (Back row) and the form (title) listen, so keep every listener.
    const listeners: Record<string, (() => void)[]> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    return {
      keyboardWillShow: () => listeners.keyboardWillShow?.forEach((cb) => cb()),
      keyboardWillHide: () => listeners.keyboardWillHide?.forEach((cb) => cb()),
    };
  }
  afterEach(() => jest.restoreAllMocks());

  it('hides the title, the business line and Back, keeps the Send bar, and gives the area slack', async () => {
    const handlers = captureKeyboard();
    await renderScreen();
    await formReady();
    const scroll = screen.getByTestId('request-form-scroll');
    await fireEvent(scroll, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } },
    });
    expect(screen.getByRole('header', { name: 'Request pickup' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Back to the map' })).toBeOnTheScreen();

    await act(async () => handlers.keyboardWillShow());
    expect(screen.queryByRole('header', { name: 'Request pickup' })).not.toBeOnTheScreen();
    expect(screen.queryByText("From Joe's Pizza")).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Back to the map' })).not.toBeOnTheScreen();
    expect(screen.getByTestId('send-bar')).toBeOnTheScreen();
    const style = Object.assign(
      {},
      ...[screen.getByTestId('request-form-scroll').props.contentContainerStyle].flat(Infinity),
    );
    expect(style.paddingBottom).toBeGreaterThanOrEqual(420);

    await act(async () => handlers.keyboardWillHide());
    expect(screen.getByRole('header', { name: 'Request pickup' })).toBeOnTheScreen();
  });
});

describe('the pickup time', () => {
  const control = () => screen.getByTestId('datetimepicker-datetime');
  const picked = (date: Date) => ({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } });
  const done = () => screen.getByRole('button', { name: 'Done, use this pickup time' });
  // Open the dialog, move the control, and tap Done.
  async function chooseTime(date: Date, open = 'Choose pickup time') {
    await fireEvent.press(screen.getByRole('button', { name: open }));
    await act(async () => control().props.onValueChange(picked(date), date));
    await fireEvent.press(done());
  }

  it("is chosen in a dialog whose control carries the server's window", async () => {
    await renderScreen();
    await formReady();
    expect(screen.getByText('No pickup time chosen yet.')).toBeOnTheScreen();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    const { minimumDate, maximumDate, minuteInterval, mode } = control().props;
    expect(mode).toBe('datetime');
    expect(minuteInterval).toBe(15);
    const now = Date.now();
    expect(minimumDate.getTime() - now).toBeGreaterThanOrEqual(15 * 60_000);
    expect(minimumDate.getTime() - now).toBeLessThanOrEqual(31 * 60_000);
    expect(maximumDate.getTime() - now).toBeLessThanOrEqual(7 * 24 * 3_600_000);
    // Nothing is chosen until Done.
    expect(screen.getByText('No pickup time chosen yet.')).toBeOnTheScreen();
    await fireEvent.press(done());
    expect(screen.getByText(/^Pickup: /)).toBeOnTheScreen();
    expect(screen.queryByTestId('pickup-time-dialog')).not.toBeOnTheScreen();
  });

  it('Cancel leaves the time as it was', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    const later = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 900_000) * 900_000);
    await act(async () => control().props.onValueChange(picked(later), later));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Cancel, keep the current pickup time' }),
    );
    expect(screen.getByText('No pickup time chosen yet.')).toBeOnTheScreen();
  });

  it('sends the chosen time as UTC', async () => {
    submitMock.mockResolvedValue(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    const chosen = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 900_000) * 900_000);
    await chooseTime(chosen);
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0][0].pickupAt.toISOString()).toBe(chosen.toISOString());
  });

  it('a time the control let through that is too soon becomes the earliest, with "Pick a later time"', async () => {
    await renderScreen();
    await formReady();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    const earliest = control().props.minimumDate as Date;
    const soon = new Date(Date.now() + 60_000);
    await act(async () => control().props.onValueChange(picked(soon), soon));
    await fireEvent.press(done());
    expect(
      await within(screen.getByTestId('send-bar')).findByText('Pick a later time'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Change pickup time' }));
    expect(control().props.value.getTime()).toBe(earliest.getTime());
  });

  it('a time too far ahead is moved to the latest, with a message', async () => {
    await renderScreen();
    await formReady();
    await chooseTime(new Date(Date.now() + 30 * 24 * 3_600_000));
    expect(
      await within(screen.getByTestId('send-bar')).findByText('Pick a time within the next 7 days'),
    ).toBeOnTheScreen();
  });

  it('a fixed-up time can be sent after choosing again', async () => {
    submitMock.mockResolvedValue(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await chooseTime(new Date(Date.now() + 60_000));
    await screen.findByText('Pick a later time');
    const later = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 900_000) * 900_000);
    await chooseTime(later, 'Change pickup time');
    await waitFor(() => expect(screen.queryByText('Pick a later time')).not.toBeOnTheScreen());
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
  });
});

describe('editing while a send is in flight', () => {
  const sendAndEdit = async () => {
    let finish: (value: ReturnType<typeof makeRequest>) => void = () => undefined;
    submitMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    // The person edits the order while the request is on its way.
    await fireEvent.press(
      screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas and a soda');
    await fireEvent.changeText(
      screen.getByLabelText('Note for the seller (optional)'),
      'ring bell',
    );
    return finish;
  };

  it('still shows "Request sent" when the send finishes, and sent exactly one request', async () => {
    const finish = await sendAndEdit();
    await act(async () => finish(makeRequest()));
    expect(await screen.findByText('Request sent')).toBeOnTheScreen();
    expect(screen.getByText("Waiting for Joe's Pizza to respond.")).toBeOnTheScreen();
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it('the steppers, text boxes and time button are disabled while sending, and the edits are ignored', async () => {
    const finish = await sendAndEdit();
    expect(screen.getByRole('button', { name: 'Increase Margherita quantity, now 0' })).toHaveProp(
      'accessibilityState',
      { disabled: true },
    );
    expect(screen.getByLabelText('Anything else')).toHaveProp('editable', false);
    expect(screen.getByLabelText('Anything else')).toHaveProp('value', 'two pizzas');
    expect(screen.getByLabelText('Note for the seller (optional)')).toHaveProp('editable', false);
    expect(screen.getByRole('button', { name: 'Change pickup time' })).toHaveProp(
      'accessibilityState',
      { disabled: true, busy: false },
    );
    await act(async () => finish(makeRequest()));
    await screen.findByText('Request sent');
  });

  it('after a failed send the form is editable again and the same order retries with the same key', async () => {
    submitMock
      .mockRejectedValueOnce(new RequestAppError('network'))
      .mockResolvedValueOnce(makeRequest());
    await renderScreen();
    await formReady();
    await fireEvent.changeText(screen.getByLabelText('Anything else'), 'two pizzas');
    await pickFirstTime();
    await fireEvent.press(send());
    await screen.findByText(/No connection/);
    expect(screen.getByLabelText('Anything else')).toHaveProp('editable', true);
    await fireEvent.press(send());
    await screen.findByText('Request sent');
    const [first, second] = submitMock.mock.calls.map(([input]) => input.idempotencyKey);
    expect(second).toBe(first);
  });
});

describe('a form left open for a while', () => {
  // Only Date is faked, so timers and promises still run.
  const fakeDate = (now: Date) =>
    jest.useFakeTimers({
      now,
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
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers times from the moment the picker opens, not from when the form was shown', async () => {
    const shown = new Date('2026-11-08T17:00:00Z');
    fakeDate(shown);
    await renderScreen();
    await formReady();
    jest.setSystemTime(new Date(shown.getTime() + 45 * 60_000));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose pickup time' }));
    const minimum = screen.getByTestId('datetimepicker-datetime').props.minimumDate as Date;
    // 45 minutes later, plus the 15-minute lead: nothing before 18:00 is offered any more.
    expect(minimum.getTime()).toBeGreaterThanOrEqual(shown.getTime() + 60 * 60_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Done, use this pickup time' }));
    expect(screen.queryByText('Pick a later time')).not.toBeOnTheScreen();
  });
});
