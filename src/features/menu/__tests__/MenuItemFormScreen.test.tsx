import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { Alert } from 'react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { removeFromBucket, signedUrls, uploadToBucket } from '@/features/media/api';
import { MediaError } from '@/features/media/errors';
import { pickImage } from '@/features/media/pickImage';
import { prepareImage } from '@/features/media/prepareImage';
import * as profileApi from '@/features/profile/api';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

import {
  MenuAppError,
  beginPhotoUpload,
  claimPhotoCleanup,
  createMenuItem,
  deleteBusinessPhoto,
  deleteMenuItem,
  finishPhotoUpload,
  getCurrencies,
  getMenu,
  setMenuCurrency,
  updateMenuItem,
} from '../api';
import { MenuItemFormScreen } from '../components/MenuItemFormScreen';
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
let mockParams: { itemId?: string; photoError?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
  useLocalSearchParams: () => mockParams,
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
const mockedCreate = createMenuItem as unknown as jest.Mock;
const mockedUpdate = updateMenuItem as unknown as jest.Mock;
const mockedDeleteItem = deleteMenuItem as unknown as jest.Mock;
const mockedBegin = beginPhotoUpload as unknown as jest.Mock;
const mockedFinish = finishPhotoUpload as unknown as jest.Mock;
const mockedDeletePhoto = deleteBusinessPhoto as unknown as jest.Mock;
const mockedClaim = claimPhotoCleanup as unknown as jest.Mock;
const mockedSignedUrls = signedUrls as unknown as jest.Mock;
const mockedUploadToBucket = uploadToBucket as unknown as jest.Mock;
const mockedRemoveFromBucket = removeFromBucket as unknown as jest.Mock;
const mockedPick = pickImage as unknown as jest.Mock;
const mockedPrepare = prepareImage as unknown as jest.Mock;
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
const noCurrency: MyBusiness = { ...restaurant, currency_code: null };

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

const itemPhoto: BusinessPhoto = {
  id: 'pi',
  business_id: 'b1',
  kind: 'item',
  menu_item_id: 'i2',
  path: 'b1/pi.jpg',
  position: null,
};

const menu: Menu = {
  items: [
    item('i1', 'Pizza', 1, { price_minor: 1250 }),
    item('i2', 'Pasta', 2, { description: 'Fresh pasta', price_minor: 1250 }),
    item('i3', 'Salad', 3, { is_available: false }),
  ],
  photos: [],
};

const PREPARED_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function deviceLocale(languageTag: string, currencyCode: string | null) {
  mockedLocales.mockReturnValue([
    { languageTag, languageCode: languageTag.slice(0, 2), currencyCode },
  ]);
}

async function renderForm(mode: 'new' | 'edit') {
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
        <MenuItemFormScreen mode={mode} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

let alertSpy: jest.SpyInstance;

type AlertButton = { text?: string; style?: string; onPress?: () => void };
function lastAlertButtons(): AlertButton[] {
  const calls = alertSpy.mock.calls;
  return (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
}
async function pressDestructive() {
  const button = lastAlertButtons().find((b) => b.style === 'destructive');
  expect(button).toBeDefined();
  await act(async () => {
    button?.onPress?.();
  });
}

const save = () => screen.getByRole('button', { name: /^save/i });
const priceField = () => screen.getByLabelText(/^Price/);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { itemId: 'i2' };
  mockRouter.canGoBack.mockReturnValue(true);
  mockedBusiness.mockReset();
  mockedBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedMenu.mockReset();
  mockedMenu.mockResolvedValue(menu);
  mockedCurrencies.mockReset();
  mockedCurrencies.mockResolvedValue(CURRENCIES);
  mockedSetCurrency.mockReset();
  mockedSetCurrency.mockResolvedValue(undefined);
  mockedCreate.mockReset();
  mockedCreate.mockResolvedValue('new-id');
  mockedUpdate.mockReset();
  mockedUpdate.mockResolvedValue(undefined);
  mockedDeleteItem.mockReset();
  mockedDeleteItem.mockResolvedValue(undefined);
  mockedBegin.mockReset();
  mockedBegin.mockResolvedValue({ photo_id: 'ph-new', path: 'b1/ph-new.jpg' });
  mockedFinish.mockReset();
  mockedFinish.mockResolvedValue({ ...itemPhoto, id: 'ph-new', path: 'b1/ph-new.jpg' });
  mockedDeletePhoto.mockReset();
  mockedDeletePhoto.mockResolvedValue(undefined);
  mockedClaim.mockReset();
  mockedClaim.mockResolvedValue([]);
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_bucket: string, paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
  );
  mockedUploadToBucket.mockReset();
  mockedUploadToBucket.mockResolvedValue(undefined);
  mockedRemoveFromBucket.mockReset();
  mockedRemoveFromBucket.mockResolvedValue(undefined);
  mockedPick.mockReset();
  mockedPick.mockResolvedValue('file:///picked.jpg');
  mockedPrepare.mockReset();
  mockedPrepare.mockResolvedValue({
    uri: 'file:///encoder.jpg',
    bytes: PREPARED_BYTES,
    width: 1200,
    height: 900,
    mimeType: 'image/jpeg',
  });
  deviceLocale('en-US', 'USD');
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('MenuItemFormScreen: the four states', () => {
  it('shows a skeleton while the menu loads', async () => {
    mockedMenu.mockReturnValue(new Promise(() => {}));
    await renderForm('edit');
    expect(await screen.findByTestId('seller-skeleton')).toBeTruthy();
  });

  it('shows an error with retry when the menu fails to load', async () => {
    mockedMenu.mockRejectedValueOnce(new MenuAppError('network'));
    await renderForm('edit');
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Name')).toHaveDisplayValue('Pasta');
    expect(mockedMenu).toHaveBeenCalledTimes(2);
  });

  it('shows an error with retry when the currencies fail to load', async () => {
    mockedCurrencies.mockRejectedValueOnce(new MenuAppError('network'));
    await renderForm('new');
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    expect(mockedCurrencies).toHaveBeenCalledTimes(2);
  });

  it('shows "This item no longer exists" with Back for an unknown item, and does not redirect', async () => {
    mockParams = { itemId: 'gone' };
    await renderForm('edit');
    expect(await screen.findByText('This item no longer exists')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('shows the empty form on success in new mode', async () => {
    await renderForm('new');
    expect(await screen.findByLabelText('Name')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Description')).toHaveDisplayValue('');
    expect(screen.getByRole('switch', { name: 'Available' })).toBeChecked();
    expect(screen.queryByRole('button', { name: /delete item/i })).toBeNull();
  });
});

describe('MenuItemFormScreen: access (Decision 14)', () => {
  it('does not redirect while the business loads', async () => {
    mockedBusiness.mockReturnValue(new Promise(() => {}));
    await renderForm('new');
    expect(await screen.findByTestId('seller-skeleton')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to onboarding after the business loads as null', async () => {
    mockedBusiness.mockResolvedValue(null);
    await renderForm('new');
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/seller/onboarding'));
  });
});

describe('MenuItemFormScreen: edit mode', () => {
  it('pre-fills name, description, price and availability from the item', async () => {
    await renderForm('edit');
    expect(await screen.findByLabelText('Name')).toHaveDisplayValue('Pasta');
    expect(screen.getByLabelText('Description')).toHaveDisplayValue('Fresh pasta');
    expect(priceField()).toHaveDisplayValue('12.50');
    expect(screen.getByRole('switch', { name: 'Available' })).toBeChecked();
  });

  it('shows an unavailable item with the switch off', async () => {
    mockParams = { itemId: 'i3' };
    await renderForm('edit');
    await screen.findByLabelText('Name');
    expect(screen.getByRole('switch', { name: 'Available' })).not.toBeChecked();
  });

  it('shows the currency code on the price field and no currency picker once a currency is set', async () => {
    await renderForm('edit');
    await screen.findByLabelText('Name');
    expect(screen.getByLabelText('Price (CAD)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Currency/ })).toBeNull();
  });

  it('saves every field with updateMenuItem, then closes', async () => {
    await renderForm('edit');
    await fireEvent.changeText(await screen.findByLabelText('Name'), '  Pasta bake ');
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Baked');
    await fireEvent.changeText(priceField(), '13,5');
    await fireEvent(screen.getByRole('switch', { name: 'Available' }), 'valueChange', false);
    await fireEvent.press(save());

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith('i2', {
      name: 'Pasta bake',
      description: 'Baked',
      price_minor: 1350,
      is_available: false,
    });
    expect(mockedCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('clears the price and the description by emptying the fields', async () => {
    await renderForm('edit');
    await fireEvent.changeText(await screen.findByLabelText('Description'), '   ');
    await fireEvent.changeText(priceField(), '');
    await fireEvent.press(save());

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith('i2', {
      name: 'Pasta',
      description: null,
      price_minor: null,
      is_available: true,
    });
  });

  it('shows a message and stays open when the server refuses the save', async () => {
    mockedUpdate.mockRejectedValue(new MenuAppError('not_found'));
    await renderForm('edit');
    await screen.findByLabelText('Name');
    await fireEvent.press(save());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('MenuItemFormScreen: add mode', () => {
  beforeEach(() => {
    mockParams = {};
  });

  it('creates an item with just a name', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.press(save());

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith({
      name: 'Soup',
      description: null,
      price_minor: null,
      is_available: true,
    });
    expect(mockedSetCurrency).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('creates an item with a description, a price and unavailable', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Tomato');
    await fireEvent.changeText(priceField(), '4,35');
    await fireEvent(screen.getByRole('switch', { name: 'Available' }), 'valueChange', false);
    await fireEvent.press(save());

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith({
      name: 'Soup',
      description: 'Tomato',
      price_minor: 435,
      is_available: false,
    });
  });

  it('refuses an empty name with an error message and saves nothing', async () => {
    await renderForm('new');
    await screen.findByLabelText('Name');
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a blank name', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), '    ');
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a name over 80 characters', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'x'.repeat(81));
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a description over 300 characters', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(screen.getByLabelText('Description'), 'x'.repeat(301));
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a price with too many decimals for the currency', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(priceField(), '4.355');
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('refuses a price that is not a number, zero, or too large', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    for (const bad of ['abc', '0', '10000000.00']) {
      await fireEvent.changeText(priceField(), bad);
      await fireEvent.press(save());
      expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    }
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('shows a message when the server says the menu is full (item_limit) and stays open', async () => {
    mockedCreate.mockRejectedValue(new MenuAppError('item_limit'));
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.press(save());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('MenuItemFormScreen: price decimals follow the currency', () => {
  beforeEach(() => {
    mockParams = {};
  });

  it('accepts whole yen and refuses decimals for JPY', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: 'JPY' });
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Ramen');
    expect(screen.getByLabelText('Price (JPY)')).toBeTruthy();

    await fireEvent.changeText(priceField(), '12.5');
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(priceField(), '1200');
    await fireEvent.press(save());
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ price_minor: 1200 });
  });

  it('reads three decimals for KWD', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: 'KWD' });
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Tea');
    await fireEvent.changeText(priceField(), '1.250');
    await fireEvent.press(save());
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ price_minor: 1250 });
  });

  it('pre-fills an edited KWD price with three decimals', async () => {
    mockedBusiness.mockResolvedValue({ ...restaurant, currency_code: 'KWD' });
    mockParams = { itemId: 'i2' };
    await renderForm('edit');
    await screen.findByLabelText('Name');
    expect(priceField()).toHaveDisplayValue('1.250');
  });
});

describe('MenuItemFormScreen: choosing the currency with the first price', () => {
  beforeEach(() => {
    mockParams = {};
    mockedBusiness.mockResolvedValue(noCurrency);
  });

  it('does not ask for a currency until a price is typed', async () => {
    await renderForm('new');
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('button', { name: /^Currency/ })).toBeNull();
    await fireEvent.changeText(priceField(), '5');
    expect(await screen.findByRole('button', { name: /^Currency/ })).toBeTruthy();
  });

  it('pre-fills the currency with the phone currency when it is in the list', async () => {
    deviceLocale('ja-JP', 'JPY');
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Ramen');
    await fireEvent.changeText(priceField(), '1200');
    const row = await screen.findByRole('button', { name: /^Currency/ });
    expect(row.props.accessibilityLabel).toContain('Japanese yen (JPY)');
  });

  it('sets the currency first, then saves the item', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(priceField(), '4.35');
    await screen.findByRole('button', { name: /^Currency/ });
    await fireEvent.press(save());

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedSetCurrency).toHaveBeenCalledWith('USD');
    expect(mockedSetCurrency.mock.invocationCallOrder[0]).toBeLessThan(
      mockedCreate.mock.invocationCallOrder[0],
    );
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ price_minor: 435 });
  });

  it('lets the seller pick another currency and uses its decimals', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Ramen');
    await fireEvent.changeText(priceField(), '1200');
    await fireEvent.press(await screen.findByRole('button', { name: /^Currency/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Japanese yen, JPY' }));
    await fireEvent.press(save());

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedSetCurrency).toHaveBeenCalledWith('JPY');
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ price_minor: 1200 });
  });

  it('opens the picker with no pre-selection when the phone currency is not in the list', async () => {
    deviceLocale('xx-XX', 'ZZZ');
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(priceField(), '4.35');
    await fireEvent.press(await screen.findByRole('button', { name: /^Currency/ }));
    const rows = await screen.findAllByRole('radio');
    for (const row of rows) expect(row).not.toBeChecked();
  });

  it('does not save a price while no currency is chosen', async () => {
    deviceLocale('xx-XX', 'ZZZ');
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(priceField(), '4.35');
    await fireEvent.press(save());
    expect((await screen.findAllByText(/^⚠/)).length).toBeGreaterThan(0);
    expect(mockedSetCurrency).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('saves an item without a price and without setting a currency', async () => {
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.press(save());
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedSetCurrency).not.toHaveBeenCalled();
  });

  it('does not create the item when setting the currency fails', async () => {
    mockedSetCurrency.mockRejectedValue(new MenuAppError('prices_exist'));
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.changeText(priceField(), '4.35');
    await screen.findByRole('button', { name: /^Currency/ });
    await fireEvent.press(save());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('MenuItemFormScreen: delete', () => {
  it('asks before deleting and does nothing on cancel', async () => {
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /delete item/i }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(lastAlertButtons().some((b) => b.style === 'cancel')).toBe(true);
    expect(mockedDeleteItem).not.toHaveBeenCalled();
  });

  it('deletes the item when the destructive button is pressed, then closes and cleans up', async () => {
    // This screen does not clean up on open, so the first claim is the one after the delete/replace.
    mockedClaim.mockResolvedValueOnce(['b1/pi.jpg']).mockResolvedValue([]);
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /delete item/i }));
    await pressDestructive();

    await waitFor(() => expect(mockedDeleteItem).toHaveBeenCalledWith('i2'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/pi.jpg']),
    );
  });

  it('shows a message and stays open when the delete fails', async () => {
    mockedDeleteItem.mockRejectedValue(new MenuAppError('network'));
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /delete item/i }));
    await pressDestructive();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('MenuItemFormScreen: the item photo', () => {
  beforeEach(() => {
    mockedMenu.mockResolvedValue({ ...menu, photos: [itemPhoto] });
  });

  it('names the photo "Photo of <item name>" as an image', async () => {
    await renderForm('edit');
    expect(await screen.findByRole('image', { name: 'Photo of Pasta' })).toBeTruthy();
  });

  it('shows "Photo unavailable" when the photo row has no signed URL (pending row)', async () => {
    mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, null])),
    );
    await renderForm('edit');
    expect(await screen.findByText('Photo unavailable')).toBeTruthy();
    expect(screen.queryByTestId('expo-image')).toBeNull();
  });

  it('shows the photo keyed by its stored path', async () => {
    await renderForm('edit');
    const image = await screen.findByTestId('expo-image');
    expect(image.props.source).toEqual({
      uri: 'https://signed.test/b1/pi.jpg',
      cacheKey: 'b1/pi.jpg',
    });
  });

  it('replaces the photo: picks, prepares, reserves for this item, uploads the prepared bytes, finishes', async () => {
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /^replace photo/i }));

    await waitFor(() => expect(mockedFinish).toHaveBeenCalledWith('ph-new'));
    expect(mockedPrepare).toHaveBeenCalledWith('file:///picked.jpg');
    expect(mockedBegin).toHaveBeenCalledWith('item', 'i2');
    expect(mockedUploadToBucket).toHaveBeenCalledWith(
      'business-media',
      'b1/ph-new.jpg',
      PREPARED_BYTES,
    );
    expect(mockedUploadToBucket.mock.calls[0][2]).toBe(PREPARED_BYTES);
  });

  it('runs the cleanup after a replace and removes the replaced file', async () => {
    // This screen does not clean up on open, so the first claim is the one after the delete/replace.
    mockedClaim.mockResolvedValueOnce(['b1/pi.jpg']).mockResolvedValue([]);
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /^replace photo/i }));
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/pi.jpg']),
    );
  });

  it('does nothing when the picker is cancelled', async () => {
    mockedPick.mockResolvedValue(null);
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /^replace photo/i }));
    await waitFor(() => expect(mockedPick).toHaveBeenCalled());
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedBegin).not.toHaveBeenCalled();
    expect(mockedUploadToBucket).not.toHaveBeenCalled();
  });

  it('uploads nothing and reserves nothing when the photo still has hidden metadata', async () => {
    mockedPrepare.mockRejectedValue(new MediaError('metadata_present'));
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /^replace photo/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockedBegin).not.toHaveBeenCalled();
    expect(mockedUploadToBucket).not.toHaveBeenCalled();
    expect(mockedFinish).not.toHaveBeenCalled();
  });

  it('removes the photo after confirmation, then cleans up', async () => {
    // This screen does not clean up on open, so the first claim is the one after the delete/replace.
    mockedClaim.mockResolvedValueOnce(['b1/pi.jpg']).mockResolvedValue([]);
    await renderForm('edit');
    await fireEvent.press(await screen.findByRole('button', { name: /^remove photo/i }));
    await pressDestructive();

    await waitFor(() => expect(mockedDeletePhoto).toHaveBeenCalledWith('pi'));
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/pi.jpg']),
    );
  });

  it('offers Add photo, and no Remove photo, when the item has no photo', async () => {
    mockedMenu.mockResolvedValue(menu);
    await renderForm('edit');
    expect(await screen.findByRole('button', { name: /^add photo/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^remove photo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^replace photo/i })).toBeNull();
  });

  it('adds a photo to a new item: uploads the prepared bytes for the new id after saving', async () => {
    mockedMenu.mockResolvedValue(menu);
    mockParams = {};
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.press(screen.getByRole('button', { name: /^add photo/i }));
    await waitFor(() => expect(mockedPick).toHaveBeenCalled());
    // Nothing is uploaded before the item exists.
    expect(mockedBegin).not.toHaveBeenCalled();

    await fireEvent.press(save());
    await waitFor(() => expect(mockedFinish).toHaveBeenCalledWith('ph-new'));
    expect(mockedCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mockedBegin.mock.invocationCallOrder[0],
    );
    expect(mockedPrepare).toHaveBeenCalledWith('file:///picked.jpg');
    expect(mockedBegin).toHaveBeenCalledWith('item', 'new-id');
    expect(mockedUploadToBucket.mock.calls[0][2]).toBe(PREPARED_BYTES);
  });

  it('keeps the saved item and uploads nothing when its photo cannot be prepared', async () => {
    mockedMenu.mockResolvedValue(menu);
    mockParams = {};
    mockedPrepare.mockRejectedValue(new MediaError('metadata_present'));
    await renderForm('new');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Soup');
    await fireEvent.press(screen.getByRole('button', { name: /^add photo/i }));
    await waitFor(() => expect(mockedPick).toHaveBeenCalled());
    await fireEvent.press(save());

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedPrepare).toHaveBeenCalled());
    expect(mockedBegin).not.toHaveBeenCalled();
    expect(mockedUploadToBucket).not.toHaveBeenCalled();
  });

  it('shows the photo problem when the item is reopened after a failed photo (photoError)', async () => {
    mockParams = { itemId: 'i2', photoError: '1' };
    await renderForm('edit');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('MenuItemFormScreen: accessibility', () => {
  it('labels every button and field, and gives the switch a name', async () => {
    await renderForm('edit');
    await screen.findByLabelText('Name');
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByLabelText(/^Price/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Available' })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      expect(String(button.props.accessibilityLabel ?? '').length).toBeGreaterThan(0);
    }
  });
});
