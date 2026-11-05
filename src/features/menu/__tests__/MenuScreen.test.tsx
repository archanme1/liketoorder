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
import { AccessibilityInfo } from 'react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { signedUrls } from '@/features/media/api';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';

import {
  MenuAppError,
  claimPhotoCleanup,
  getCurrencies,
  getMenu,
  moveMenuItem,
  setMenuCurrency,
  updateMenuItem,
} from '../api';
import { MenuScreen } from '../components/MenuScreen';
import type { BusinessPhoto, Currency, Menu, MenuItem } from '../schema';

// useSignedUrls keeps its URLs for 55 minutes after unmount (Decision 15); unmount first, then
// clear every client so no gc timer outlives the test and keeps the jest worker alive.
const testClients: QueryClient[] = [];
afterEach(async () => {
  await cleanup();
  testClients.splice(0).forEach((client) => client.clear());
});

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() } },
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMenu: jest.fn(),
  getCurrencies: jest.fn(),
  setMenuCurrency: jest.fn(),
  createMenuItem: jest.fn(),
  updateMenuItem: jest.fn(),
  moveMenuItem: jest.fn(),
  deleteMenuItem: jest.fn(),
  beginPhotoUpload: jest.fn(),
  finishPhotoUpload: jest.fn(),
  deleteBusinessPhoto: jest.fn(),
  claimPhotoCleanup: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/media/pickImage', () => ({ pickImage: jest.fn() }));
jest.mock('@/features/media/prepareImage', () => ({ prepareImage: jest.fn() }));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedBusiness = getMyBusiness as unknown as jest.Mock;
const mockedProfile = profileApi.getMyProfile as unknown as jest.Mock;
const mockedMenu = getMenu as unknown as jest.Mock;
const mockedCurrencies = getCurrencies as unknown as jest.Mock;
const mockedSetCurrency = setMenuCurrency as unknown as jest.Mock;
const mockedUpdate = updateMenuItem as unknown as jest.Mock;
const mockedMove = moveMenuItem as unknown as jest.Mock;
const mockedClaim = claimPhotoCleanup as unknown as jest.Mock;
const mockedSignedUrls = signedUrls as unknown as jest.Mock;
const mockedLocales = getLocales as unknown as jest.Mock;

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
const profile: profileApi.Profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const restaurant: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '1 Main St, Toronto, ON',
  is_listed: true,
  currency_code: 'CAD',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};

const CURRENCIES: Currency[] = [
  { code: 'CAD', name: 'Canadian dollar', minor_units: 2 },
  { code: 'EUR', name: 'Euro', minor_units: 2 },
  { code: 'JPY', name: 'Japanese yen', minor_units: 0 },
  { code: 'KWD', name: 'Kuwaiti dinar', minor_units: 3 },
  { code: 'USD', name: 'US dollar', minor_units: 2 },
];

function item(id: string, name: string, position: number, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    business_id: 'b1',
    name,
    description: null,
    price_minor: null,
    is_available: true,
    position,
    ...extra,
  };
}

function photo(
  id: string,
  kind: BusinessPhoto['kind'],
  position: number | null,
  menuItemId: string | null = null,
): BusinessPhoto {
  return {
    id,
    business_id: 'b1',
    kind,
    menu_item_id: menuItemId,
    path: `b1/${id}.jpg`,
    position,
  };
}

const threeItems: Menu = {
  items: [
    item('i1', 'Pizza', 1, { price_minor: 1250 }),
    item('i2', 'Pasta', 2),
    item('i3', 'Salad', 3, { price_minor: 900, is_available: false }),
  ],
  photos: [],
};
const noPrices: Menu = {
  items: [item('i1', 'Pizza', 1), item('i2', 'Pasta', 2), item('i3', 'Salad', 3)],
  photos: [],
};

function deviceLocale(languageTag: string, currencyCode: string | null) {
  mockedLocales.mockReturnValue([
    { languageTag, languageCode: languageTag.slice(0, 2), currencyCode },
  ]);
}

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  testClients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MenuScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

// The list order, read from each row's "<name> available" switch.
function listOrder(): string[] {
  return screen
    .getAllByRole('switch')
    .map((sw) => String(sw.props.accessibilityLabel).replace(/ available$/, ''));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let announce: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockedBusiness.mockReset();
  mockedBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedMenu.mockReset();
  mockedMenu.mockResolvedValue(threeItems);
  mockedCurrencies.mockReset();
  mockedCurrencies.mockResolvedValue(CURRENCIES);
  mockedSetCurrency.mockReset();
  mockedSetCurrency.mockResolvedValue(undefined);
  mockedUpdate.mockReset();
  mockedUpdate.mockResolvedValue(undefined);
  mockedMove.mockReset();
  mockedMove.mockResolvedValue(undefined);
  mockedClaim.mockReset();
  mockedClaim.mockResolvedValue([]);
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_bucket: string, paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
  );
  deviceLocale('en-US', 'USD');
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  announce.mockRestore();
});

describe('MenuScreen: the four states', () => {
  it('shows a skeleton while the menu loads', async () => {
    mockedMenu.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(await screen.findByTestId('seller-skeleton')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
  });

  it('shows an error with retry, and the retry loads the menu', async () => {
    mockedMenu.mockRejectedValueOnce(new MenuAppError('network'));
    await renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch', { name: 'Pizza available' })).toBeTruthy();
    expect(mockedMenu).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when there are no items and no menu photos', async () => {
    mockedMenu.mockResolvedValue({ items: [], photos: [] });
    await renderScreen();
    expect(
      await screen.findByText(
        'No menu items yet. Add your first item, or upload menu photos instead.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled();
  });

  it('shows the items in order on success', async () => {
    await renderScreen();
    expect(await screen.findByRole('switch', { name: 'Pizza available' })).toBeTruthy();
    expect(listOrder()).toEqual(['Pizza', 'Pasta', 'Salad']);
    expect(screen.queryByText(/No menu items yet/)).toBeNull();
  });
});

describe('MenuScreen: access (Decision 14)', () => {
  it('does not redirect while the business loads', async () => {
    mockedBusiness.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(await screen.findByTestId('seller-skeleton')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockedMenu).not.toHaveBeenCalled();
  });

  it('redirects to onboarding after the business loads as null', async () => {
    mockedBusiness.mockResolvedValue(null);
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/seller/onboarding'));
  });

  it('lets an owner with seller mode off open the menu', async () => {
    mockedProfile.mockResolvedValue({ ...profile, is_seller: false });
    mockedBusiness.mockResolvedValue({ ...restaurant, is_listed: false });
    await renderScreen();
    expect(await screen.findByRole('switch', { name: 'Pizza available' })).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe('MenuScreen: prices and the Currency row', () => {
  it('shows the currency as "Canadian dollar (CAD)"', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    expect(screen.getByRole('button', { name: /^Currency/ }).props.accessibilityLabel).toContain(
      'Canadian dollar (CAD)',
    );
  });

  it('shows "Not set" when the business has no currency', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: null });
    mockedMenu.mockResolvedValue(noPrices);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    expect(screen.getByRole('button', { name: /^Currency/ }).props.accessibilityLabel).toContain(
      'Not set',
    );
  });

  it('formats each price in the currency and the phone language, and shows nothing for no price', async () => {
    deviceLocale('en-CA', 'CAD');
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.getByText('$9.00')).toBeTruthy();
  });

  it('formats EUR for a German phone as "12,50 €"', async () => {
    deviceLocale('de-DE', 'EUR');
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: 'EUR' });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    // \s also matches the (narrow) no-break space Intl puts between amount and symbol.
    expect(screen.getByText(/^12,50\s€$/)).toBeTruthy();
  });

  it('formats JPY without decimals and KWD with three', async () => {
    deviceLocale('en-US', 'JPY');
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: 'JPY' });
    mockedMenu.mockResolvedValue({
      items: [item('i1', 'Ramen', 1, { price_minor: 1200 })],
      photos: [],
    });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Ramen available' });
    expect(screen.getByText('¥1,200')).toBeTruthy();
  });

  it('formats KWD with three decimals', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: 'KWD' });
    mockedMenu.mockResolvedValue({
      items: [item('i1', 'Tea', 1, { price_minor: 1250 })],
      photos: [],
    });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Tea available' });
    expect(screen.getByText(/^KWD\s1\.250$/)).toBeTruthy();
  });

  it('locks the Currency row, with a reason, once any item has a price', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    const row = screen.getByRole('button', { name: /^Currency/ });
    expect(row).toBeDisabled();
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    expect(String(row.props.accessibilityHint)).toMatch(/price/i);
    expect(screen.getByText(/price/i)).toBeTruthy();

    await fireEvent.press(row);
    expect(screen.queryByText('Choose a currency')).toBeNull();
    expect(mockedSetCurrency).not.toHaveBeenCalled();
  });

  it('keeps the Currency row enabled while no item has a price, and opens the picker', async () => {
    mockedMenu.mockResolvedValue(noPrices);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    const row = screen.getByRole('button', { name: /^Currency/ });
    expect(row).toBeEnabled();
    await fireEvent.press(row);
    expect(await screen.findByRole('radio', { name: 'Canadian dollar, CAD' })).toBeChecked();
  });

  it('saves a currency picked from the list', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: null });
    mockedMenu.mockResolvedValue(noPrices);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: /^Currency/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Japanese yen, JPY' }));
    await waitFor(() => expect(mockedSetCurrency).toHaveBeenCalledWith('JPY'));
  });

  it('pre-fills the picker with the phone currency when it is in the list', async () => {
    deviceLocale('ja-JP', 'JPY');
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: null });
    mockedMenu.mockResolvedValue(noPrices);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: /^Currency/ }));
    expect(await screen.findByRole('radio', { name: 'Japanese yen, JPY' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'US dollar, USD' })).not.toBeChecked();
  });

  it('has no pre-selection when the phone currency is not in the list', async () => {
    deviceLocale('xx-XX', 'ZZZ');
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: null });
    mockedMenu.mockResolvedValue(noPrices);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: /^Currency/ }));
    const rows = await screen.findAllByRole('radio');
    expect(rows.length).toBe(CURRENCIES.length);
    for (const row of rows) expect(row).not.toBeChecked();
  });

  it('shows a message when the server refuses the change (prices_exist)', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: null });
    mockedMenu.mockResolvedValue(noPrices);
    mockedSetCurrency.mockRejectedValue(new MenuAppError('prices_exist'));
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: /^Currency/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Euro, EUR' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('MenuScreen: item rows', () => {
  it('shows "Unavailable" as text on an unavailable item only', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    expect(screen.getAllByText('Unavailable')).toHaveLength(1);
  });

  it('exposes an "<name> available" switch per item reflecting its state', async () => {
    await renderScreen();
    expect(await screen.findByRole('switch', { name: 'Pizza available' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Pasta available' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Salad available' })).not.toBeChecked();
  });

  it('toggles availability from the list and shows the tag at once', async () => {
    // After the save the server reports the new state.
    mockedMenu.mockResolvedValueOnce(threeItems).mockResolvedValue({
      items: [
        threeItems.items[0],
        { ...threeItems.items[1], is_available: false },
        threeItems.items[2],
      ],
      photos: [],
    });
    await renderScreen();
    const sw = await screen.findByRole('switch', { name: 'Pasta available' });
    await fireEvent(sw, 'valueChange', false);
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate.mock.calls[0][0]).toBe('i2');
    expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ name: 'Pasta', is_available: false });
    await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(2));
  });

  it('puts an unavailable item back on from the list', async () => {
    await renderScreen();
    const sw = await screen.findByRole('switch', { name: 'Salad available' });
    await fireEvent(sw, 'valueChange', true);
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate.mock.calls[0][0]).toBe('i3');
    expect(mockedUpdate.mock.calls[0][1]).toMatchObject({
      is_available: true,
      price_minor: 900,
    });
  });

  it('rolls the switch back when the save fails', async () => {
    mockedUpdate.mockRejectedValue(new MenuAppError('network'));
    mockedMenu.mockResolvedValueOnce(threeItems).mockReturnValue(new Promise(() => {}));
    await renderScreen();
    const sw = await screen.findByRole('switch', { name: 'Pasta available' });
    await fireEvent(sw, 'valueChange', false);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Pasta available' })).toBeChecked(),
    );
    expect(screen.getAllByText('Unavailable')).toHaveLength(1);
  });

  it('opens the item to edit when its row is pressed', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pasta available' });
    await fireEvent.press(screen.getByRole('button', { name: /^Edit Pasta/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/menu/i2');
  });

  it('shows a signed-URL thumbnail keyed by the stored path', async () => {
    mockedMenu.mockResolvedValue({
      items: threeItems.items,
      photos: [photo('pi', 'item', null, 'i2')],
    });
    await renderScreen();
    const image = await screen.findByTestId('expo-image', { includeHiddenElements: true });
    expect(image.props.source).toEqual({
      uri: 'https://signed.test/b1/pi.jpg',
      cacheKey: 'b1/pi.jpg',
    });
    expect(image.props.cachePolicy).toBe('memory-disk');
  });

  it('shows "Photo unavailable", not a broken tile, when an item photo has no signed URL', async () => {
    mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, null])),
    );
    mockedMenu.mockResolvedValue({
      items: threeItems.items,
      photos: [photo('pi', 'item', null, 'i2')],
    });
    await renderScreen();
    expect(
      await screen.findByText('Photo unavailable', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByTestId('expo-image', { includeHiddenElements: true })).toBeNull();
  });
});

describe('MenuScreen: move controls', () => {
  it('labels the buttons "Move <name> up" and "Move <name> down" with a button role', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    for (const name of ['Pizza', 'Pasta', 'Salad']) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toBeTruthy();
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toBeTruthy();
    }
  });

  it("disables the first item's up and the last item's down only", async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    const firstUp = screen.getByRole('button', { name: 'Move Pizza up' });
    const lastDown = screen.getByRole('button', { name: 'Move Salad down' });
    expect(firstUp).toBeDisabled();
    expect(firstUp.props.accessibilityState).toMatchObject({ disabled: true });
    expect(lastDown).toBeDisabled();
    expect(lastDown.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: 'Move Pizza down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Pasta up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Pasta down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Salad up' })).toBeEnabled();
  });

  it('does nothing when a disabled end button is pressed', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: 'Move Pizza up' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Move Salad down' }));
    expect(mockedMove).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('ignores an assistive-technology activation of a disabled end button', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    // RNTL never presses a disabled control, so fire the host's own onClick (what a screen reader's
    // double tap calls), the same path the Pressable's onPress is reached by.
    const activate = async (label: string) => {
      const control = screen.getByRole('button', { name: label });
      await act(async () => {
        control.props.onClick({ stopPropagation: () => {}, nativeEvent: {} });
      });
    };
    await activate('Move Pizza up');
    await activate('Move Salad down');
    expect(mockedMove).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();

    // The same path works on an enabled button, so the check above can fail.
    await activate('Move Pasta up');
    expect(mockedMove).toHaveBeenCalledWith('i2', 'up');
  });

  it('calls moveMenuItem with "up" and swaps the list at once (optimistic)', async () => {
    const pending = deferred<void>();
    mockedMove.mockReturnValue(pending.promise);
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pasta available' });

    await fireEvent.press(screen.getByRole('button', { name: 'Move Pasta up' }));

    expect(mockedMove).toHaveBeenCalledWith('i2', 'up');
    // The server has not answered yet, and the list already shows the new order.
    await waitFor(() => expect(listOrder()).toEqual(['Pasta', 'Pizza', 'Salad']));
    // The ends follow the new order.
    expect(screen.getByRole('button', { name: 'Move Pasta up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Pizza up' })).toBeEnabled();

    await act(async () => {
      pending.resolve();
    });
  });

  it('calls moveMenuItem with "down" and swaps the list at once', async () => {
    mockedMove.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });

    await fireEvent.press(screen.getByRole('button', { name: 'Move Pizza down' }));

    expect(mockedMove).toHaveBeenCalledWith('i1', 'down');
    await waitFor(() => expect(listOrder()).toEqual(['Pasta', 'Pizza', 'Salad']));
  });

  it('puts the order back when the move is rejected', async () => {
    const pending = deferred<void>();
    mockedMove.mockReturnValue(pending.promise);
    // After the first load, keep any refetch pending so only the rollback can restore the order.
    mockedMenu.mockResolvedValueOnce(threeItems).mockReturnValue(new Promise(() => {}));
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pasta available' });

    await fireEvent.press(screen.getByRole('button', { name: 'Move Pasta up' }));
    await waitFor(() => expect(listOrder()).toEqual(['Pasta', 'Pizza', 'Salad']));

    await act(async () => {
      pending.reject(new MenuAppError('network'));
    });

    await waitFor(() => expect(listOrder()).toEqual(['Pizza', 'Pasta', 'Salad']));
    expect(screen.getByRole('button', { name: 'Move Pizza up' })).toBeDisabled();
  });

  it('announces "<name> moved to position k of n"', async () => {
    // After the first move the server reports the swapped order.
    mockedMenu.mockResolvedValueOnce(threeItems).mockResolvedValue({
      items: [threeItems.items[1], threeItems.items[0], threeItems.items[2]],
      photos: [],
    });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pasta available' });

    await fireEvent.press(screen.getByRole('button', { name: 'Move Pasta up' }));
    expect(announce).toHaveBeenCalledWith('Pasta moved to position 1 of 3');

    await waitFor(() => expect(listOrder()[0]).toBe('Pasta'));
    await fireEvent.press(screen.getByRole('button', { name: 'Move Pizza down' }));
    expect(announce).toHaveBeenLastCalledWith('Pizza moved to position 3 of 3');
  });
});

describe('MenuScreen: Add item and the item limit', () => {
  it('opens the new item form', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: 'Add item' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/menu/new');
  });

  it('keeps Add item enabled at 99 items', async () => {
    mockedMenu.mockResolvedValue({
      items: Array.from({ length: 99 }, (_, i) => item(`i${i}`, `Dish ${i + 1}`, i + 1)),
      photos: [],
    });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Dish 1 available' });
    expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled();
  });

  it('disables Add item at 100 items and says why', async () => {
    mockedMenu.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, i) => item(`i${i}`, `Dish ${i + 1}`, i + 1)),
      photos: [],
    });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Dish 1 available' });
    const add = screen.getByRole('button', { name: 'Add item' });
    expect(add).toBeDisabled();
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect(String(add.props.accessibilityHint)).toMatch(/100/);
    expect(screen.getByText(/100 items/)).toBeTruthy();

    await fireEvent.press(add);
    expect(mockRouter.push).not.toHaveBeenCalledWith('/seller/menu/new');
  });
});

describe('MenuScreen: menu photos row', () => {
  it('shows "Menu photos (n/10)" and opens the photos screen at the menu section', async () => {
    mockedMenu.mockResolvedValue({
      items: threeItems.items,
      photos: [photo('m1', 'menu', 1), photo('m2', 'menu', 2)],
    });
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    await fireEvent.press(screen.getByRole('button', { name: /Menu photos \(2\/10\)/ }));

    // The spec's target: /seller/photos with the section=menu param. The scroll to that section
    // can't be observed under jest; the device run covers it.
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/seller/photos',
      params: { section: 'menu' },
    });
  });

  it('shows 0/10 with no menu photos', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    expect(screen.getByRole('button', { name: /Menu photos \(0\/10\)/ })).toBeTruthy();
  });

  it('does not show the empty state when only menu photos exist', async () => {
    mockedMenu.mockResolvedValue({ items: [], photos: [photo('m1', 'menu', 1)] });
    await renderScreen();
    await screen.findByRole('button', { name: /Menu photos \(1\/10\)/ });
    expect(screen.queryByText(/No menu items yet/)).toBeNull();
  });
});

describe('MenuScreen: storage cleanup', () => {
  it('runs the cleanup when the screen opens and removes the returned paths', async () => {
    const { removeFromBucket } = jest.requireMock('@/features/media/api') as {
      removeFromBucket: jest.Mock;
    };
    removeFromBucket.mockReset();
    removeFromBucket.mockResolvedValue(undefined);
    mockedClaim.mockResolvedValueOnce(['b1/queued.jpg']).mockResolvedValue([]);

    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });

    await waitFor(() =>
      expect(removeFromBucket).toHaveBeenCalledWith('business-media', ['b1/queued.jpg']),
    );
    expect(mockedClaim.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('MenuScreen: accessibility', () => {
  it('gives every control an accessible name and a role', async () => {
    await renderScreen();
    await screen.findByRole('switch', { name: 'Pizza available' });
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(String(button.props.accessibilityLabel ?? '').length).toBeGreaterThan(0);
    }
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    for (const control of switches) {
      expect(String(control.props.accessibilityLabel ?? '')).toMatch(/ available$/);
      expect(control.props.accessibilityRole).toBe('switch');
    }
    expect(
      within(screen.getByRole('button', { name: /^Edit Salad/ })).getByText('Unavailable'),
    ).toBeTruthy();
  });
});
