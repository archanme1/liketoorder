import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { getLocales } from 'expo-localization';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { clearReturnTo, peekReturnTo } from '@/features/auth/returnTo';
import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';
import { getCurrencies } from '@/features/menu/api';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import {
  fetchHomemadeDetails,
  fetchHomemadeInBounds,
  fetchPinsInBounds,
  fetchRestaurantDetails,
} from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { SheetActionRow } from '../components/SheetActionRow';
import type { DetailsItem } from '../schema';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  signedUrls: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  fetchPinsInBounds: jest.fn(),
  fetchRestaurantDetails: jest.fn(),
  fetchHomemadeInBounds: jest.fn(),
  fetchHomemadeDetails: jest.fn(),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

// A real uuid: the sign-in return only accepts a request form for a uuid.
const ID = '11111111-1111-4111-8111-111111111111';
const pin = { id: ID, name: 'Rosa', cuisine_code: 'IT', lat: 46.6, lng: 2.5 };
const items: DetailsItem[] = [
  {
    id: 'i1',
    name: 'Pasta',
    description: null,
    price_minor: 1200,
    is_available: true,
    position: 1,
  },
];
const restaurantDetails = {
  id: ID,
  name: 'Rosa',
  cuisine_code: 'IT',
  accepts_table_requests: false,
  public_address: '1 King St',
  place_id: 'FAKE',
  currency_code: 'CAD',
  photos: [],
  items,
};
const homemadeDetails = {
  id: ID,
  name: 'Rosa',
  cuisine_code: 'IT',
  currency_code: 'CAD',
  photos: [],
  items,
};

const guest: AuthContextValue = {
  session: null,
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
};
const signedIn: AuthContextValue = {
  ...guest,
  session: { user: { id: 'u1' } } as unknown as AuthContextValue['session'],
};

let client: QueryClient;
function wrap(ui: ReactNode, auth: AuthContextValue | null) {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const inner = auth ? <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider> : ui;
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        {inner}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  clearReturnTo();
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  const answer = { pins: [pin], capped: false, too_large: false };
  jest.mocked(fetchPinsInBounds).mockResolvedValue(answer);
  jest.mocked(fetchHomemadeInBounds).mockResolvedValue(answer);
  jest.mocked(fetchRestaurantDetails).mockResolvedValue(restaurantDetails);
  jest.mocked(fetchHomemadeDetails).mockResolvedValue(homemadeDetails);
  jest.mocked(listCuisines).mockResolvedValue([]);
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest.mocked(getMyBusiness).mockResolvedValue(null);
  // The demo pin is in France: open the map there.
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
    );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  clearReturnTo();
});

const BUTTON = { name: 'Request pickup from Rosa' };
const row = () => screen.queryByTestId('sheet-actions');
const dump = () => {
  const seen = new WeakSet<object>();
  return JSON.stringify(screen.toJSON(), (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
};
const at = (needle: string) => dump().indexOf(needle);

async function openSheet(ui: ReactNode, auth: AuthContextValue | null) {
  await render(wrap(ui, auth));
  await fireEvent.press(await screen.findByRole('button', { name: /^Rosa/ }));
  await screen.findByText('Menu');
}

const tabs = [
  ['Restaurants', <RestaurantMapScreen key="r" />],
  ['Homemade', <HomemadeMapScreen key="h" />],
] as const;

describe.each(tabs)('%s sheet: the fixed action row', (_name, ui) => {
  it('sits under the header and outside the scrolling content', async () => {
    await openSheet(ui, guest);
    expect(await screen.findByRole('button', BUTTON)).toBeOnTheScreen();
    const scroll = screen.getByTestId('sheet-scroll');
    expect(within(scroll).queryByRole('button', BUTTON)).not.toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-actions')).getByRole('button', BUTTON),
    ).toBeOnTheScreen();
    const order = [
      '"testID":"sheet-title"',
      '"testID":"sheet-actions"',
      '"testID":"sheet-scroll"',
    ].map(at);
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows at the half and full snaps and not at the collapsed one', async () => {
    await openSheet(ui, guest);
    await screen.findByRole('button', BUTTON);
    const sheet = () => screen.getByTestId('bottom-sheet');
    await act(async () => sheet().props.onChange(0));
    expect(row()).not.toBeOnTheScreen();
    await act(async () => sheet().props.onChange(1));
    expect(await screen.findByRole('button', BUTTON)).toBeOnTheScreen();
    await act(async () => sheet().props.onChange(0));
    expect(row()).not.toBeOnTheScreen();
    await act(async () => sheet().props.onChange(2));
    expect(await screen.findByRole('button', BUTTON)).toBeOnTheScreen();
  });

  it('guest: tapping remembers this business and opens sign-in', async () => {
    await openSheet(ui, guest);
    await fireEvent.press(await screen.findByRole('button', BUTTON));
    expect(peekReturnTo()).toBe(`/requests/new?businessId=${ID}`);
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
  });

  it('signed in: opens the request form', async () => {
    await openSheet(ui, signedIn);
    await fireEvent.press(await screen.findByRole('button', BUTTON));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/requests/new',
      params: { businessId: ID },
    });
  });

  it('the owner of this business sees no row at all', async () => {
    jest.mocked(getMyBusiness).mockResolvedValue({ id: ID } as unknown as MyBusiness);
    await openSheet(ui, signedIn);
    await waitFor(() => expect(getMyBusiness).toHaveBeenCalled());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(row()).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', BUTTON)).not.toBeOnTheScreen();
  });

  it('outside the auth provider there is no row (so the older sheet tests render without it)', async () => {
    await openSheet(ui, null);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(row()).not.toBeOnTheScreen();
    expect(screen.queryByText(/request pickup/i)).not.toBeOnTheScreen();
  });

  it('is not there when the business is not available', async () => {
    jest.mocked(fetchRestaurantDetails).mockResolvedValue(null);
    jest.mocked(fetchHomemadeDetails).mockResolvedValue(null);
    await render(wrap(ui, guest));
    await fireEvent.press(await screen.findByRole('button', { name: /^Rosa/ }));
    await screen.findByRole('alert');
    expect(row()).not.toBeOnTheScreen();
  });

  it('is not there while the details are still loading', async () => {
    jest.mocked(fetchRestaurantDetails).mockReturnValue(new Promise(() => undefined));
    jest.mocked(fetchHomemadeDetails).mockReturnValue(new Promise(() => undefined));
    await render(wrap(ui, guest));
    await fireEvent.press(await screen.findByRole('button', { name: /^Rosa/ }));
    expect(await screen.findByLabelText(/^Loading/)).toBeOnTheScreen();
    expect(row()).not.toBeOnTheScreen();
  });
});

describe('SheetActionRow', () => {
  const action = (key: string, title: string, onPress = jest.fn()) => ({
    key,
    title,
    accessibilityLabel: `${title} here`,
    onPress,
  });
  const flat = (node: { props: { style?: unknown } }) =>
    Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));

  it('renders nothing for no actions (no empty space is reserved)', async () => {
    await render(<SheetActionRow actions={[]} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('one or two buttons that wrap, each with a 44 pt target and its own label', async () => {
    const first = jest.fn();
    const second = jest.fn();
    await render(
      <SheetActionRow
        actions={[action('a', 'Request pickup', first), action('b', 'Reserve a table', second)]}
      />,
    );
    expect(flat(screen.getByTestId('sheet-actions')).flexWrap).toBe('wrap');
    expect(flat(screen.getByTestId('sheet-actions')).height).toBeUndefined();
    for (const button of screen.getAllByRole('button')) {
      expect(flat(button).minHeight).toBeGreaterThanOrEqual(44);
      expect(flat(button).height).toBeUndefined();
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Request pickup here' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reserve a table here' }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
