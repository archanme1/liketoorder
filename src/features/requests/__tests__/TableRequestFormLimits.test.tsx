import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fetchRestaurantDetails } from '@/features/map/api';

import { BUSINESS_ID } from '../__fixtures__/requests';
import { RequestAppError, submitTableRequest } from '../api';
import { TableRequestScreen } from '../components/TableRequestScreen';

jest.setTimeout(15_000);

// One router object for every render: a new one each time would re-run the form's effects forever.
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
// KeyboardAvoidingView and ScrollView become plain Views, and the ScrollView ref has a scrollTo.
jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createElement } = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const KeyboardAvoidingView = (props: { children?: unknown }) =>
    createElement(View, { testID: 'keyboard-avoiding', ...props });
  return { __esModule: true, default: KeyboardAvoidingView };
});
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const ScrollView = React.forwardRef(function MockScrollView(
    props: { children?: unknown },
    ref: unknown,
  ) {
    React.useImperativeHandle(ref, () => ({ scrollTo: () => undefined }));
    return React.createElement(View, props, props.children);
  });
  return { __esModule: true, default: ScrollView };
});

const submitMock = jest.mocked(submitTableRequest);
const restaurantMock = jest.mocked(fetchRestaurantDetails);

const restaurant = () => ({
  id: BUSINESS_ID,
  name: "Luigi's",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  public_address: '1 King St',
  place_id: 'FAKE_PLACE',
  currency_code: 'CAD' as string | null,
  photos: [],
  items: [],
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
  submitMock.mockReset();
  restaurantMock.mockReset();
  restaurantMock.mockResolvedValue(restaurant());
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('the request limits (spec 11b)', () => {
  it.each([
    [
      'too_many_pending',
      'You have too many requests waiting. You can have up to 3 pickup and 3 table requests waiting, and 1 per place. Cancel one or wait for an answer.',
    ],
    [
      'rate_limited',
      "You've sent a lot of requests to this place today. Please try again tomorrow.",
    ],
  ] as const)('shows the new wording for %s and keeps the form', async (code, message) => {
    submitMock.mockRejectedValue(new RequestAppError(code));
    await renderScreen();
    await formReady();
    await pickFirstTime();
    await fireEvent.press(send());
    expect(
      await within(await screen.findByTestId('send-bar')).findByText(message),
    ).toBeOnTheScreen();
    expect(send()).toBeOnTheScreen();
  });
});
