import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { Alert } from 'react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { removeFromBucket, signedUrls, uploadToBucket } from '@/features/media/api';
import * as profileApi from '@/features/profile/api';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

import { MenuAppError, claimPhotoCleanup, deleteMenuItem, getCurrencies, getMenu } from '../api';
import { MenuItemFormScreen } from '../components/MenuItemFormScreen';
import type { Currency, Menu, MenuItem } from '../schema';

// Spec 06 Decision 31: a confirmed delete closes the form even though the refreshed menu no longer
// has the item; "This item no longer exists" never shows because of the seller's own delete.

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
  useLocalSearchParams: () => ({ itemId: 'i2' }),
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
const mockedDeleteItem = deleteMenuItem as unknown as jest.Mock;
const mockedClaim = claimPhotoCleanup as unknown as jest.Mock;
const mockedSignedUrls = signedUrls as unknown as jest.Mock;
const mockedUploadToBucket = uploadToBucket as unknown as jest.Mock;
const mockedRemoveFromBucket = removeFromBucket as unknown as jest.Mock;
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
const CURRENCIES: Currency[] = [{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }];

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

const withItem: Menu = {
  items: [
    item('i1', 'Pizza', 1, { price_minor: 1250 }),
    item('i2', 'Pasta', 2, { description: 'Fresh pasta', price_minor: 1250 }),
    item('i3', 'Salad', 3),
  ],
  photos: [],
};
const withoutItem: Menu = {
  items: [withItem.items[0], { ...withItem.items[2], position: 2 }],
  photos: [],
};

// The real server: the menu has the item until the delete has been accepted, and not after.
let deleted = false;

async function renderForm() {
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
        <MenuItemFormScreen mode="edit" />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

let alertSpy: jest.SpyInstance;
type AlertButton = { text?: string; style?: string; onPress?: () => void };
async function confirmDelete() {
  await fireEvent.press(await screen.findByRole('button', { name: /delete item/i }));
  const calls = alertSpy.mock.calls;
  const buttons = (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
  const destructive = buttons.find((b) => b.style === 'destructive');
  expect(destructive).toBeDefined();
  await act(async () => {
    destructive?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  deleted = false;
  mockRouter.canGoBack.mockReturnValue(true);
  mockedBusiness.mockReset();
  mockedBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedMenu.mockReset();
  mockedMenu.mockImplementation(async () => (deleted ? withoutItem : withItem));
  mockedCurrencies.mockReset();
  mockedCurrencies.mockResolvedValue(CURRENCIES);
  mockedDeleteItem.mockReset();
  mockedDeleteItem.mockImplementation(async () => {
    deleted = true;
  });
  mockedClaim.mockReset();
  mockedClaim.mockResolvedValue([]);
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
  );
  mockedUploadToBucket.mockReset();
  mockedRemoveFromBucket.mockReset();
  mockedRemoveFromBucket.mockResolvedValue(undefined);
  mockedLocales.mockReturnValue([
    { languageTag: 'en-US', languageCode: 'en', currencyCode: 'USD' },
  ]);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('MenuItemFormScreen: delete closes the form (Decision 31)', () => {
  it('deletes the item, goes Back, and never shows "This item no longer exists"', async () => {
    await renderForm();
    expect(await screen.findByLabelText('Name')).toHaveDisplayValue('Pasta');

    await confirmDelete();

    // Right after the confirmation, and while the refreshed menu arrives, no not-found screen.
    expect(screen.queryByText('This item no longer exists')).toBeNull();
    await waitFor(() => expect(mockedDeleteItem).toHaveBeenCalledWith('i2'));
    expect(screen.queryByText('This item no longer exists')).toBeNull();

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(deleted).toBe(true);
    expect(screen.queryByText('This item no longer exists')).toBeNull();
  });

  it('closes with Back once, not twice, and does not redirect to onboarding', async () => {
    await renderForm();
    await screen.findByLabelText('Name');
    await confirmDelete();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('keeps the form and shows an error when the delete fails', async () => {
    mockedDeleteItem.mockReset();
    mockedDeleteItem.mockRejectedValue(new MenuAppError('network'));
    await renderForm();
    await screen.findByLabelText('Name');

    await confirmDelete();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('Pasta');
    expect(screen.queryByText('This item no longer exists')).toBeNull();
    expect(deleted).toBe(false);
  });
});
