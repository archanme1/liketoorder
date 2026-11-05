import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { Alert } from 'react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { removeFromBucket, signedUrls, uploadToBucket } from '@/features/media/api';
import { pickImage } from '@/features/media/pickImage';
import { prepareImage } from '@/features/media/prepareImage';
import * as profileApi from '@/features/profile/api';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

import {
  beginPhotoUpload,
  claimPhotoCleanup,
  deleteBusinessPhoto,
  finishPhotoUpload,
  getCurrencies,
  getMenu,
} from '../api';
import { BusinessPhotosScreen } from '../components/BusinessPhotosScreen';
import { MenuItemFormScreen } from '../components/MenuItemFormScreen';
import type { BusinessPhoto, Currency, Menu, MenuItem } from '../schema';

// Spec 06 Decision 31 / DoD "One upload at a time": while a photo upload is running, every control
// that would start another one does nothing and the buttons are disabled.

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
let mockParams: { itemId?: string; section?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
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
const coverPhoto: BusinessPhoto = {
  id: 'c1',
  business_id: 'b1',
  kind: 'cover',
  menu_item_id: null,
  path: 'b1/c1.jpg',
  position: null,
};
const itemPhoto: BusinessPhoto = {
  id: 'pi',
  business_id: 'b1',
  kind: 'item',
  menu_item_id: 'i2',
  path: 'b1/pi.jpg',
  position: null,
};
const photosMenu: Menu = { items: [], photos: [coverPhoto] };
const itemMenu: Menu = {
  items: [item('i1', 'Pizza', 1), item('i2', 'Pasta', 2)],
  photos: [itemPhoto],
};

const PREPARED_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  testClients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}

let alertSpy: jest.SpyInstance;
type AlertButton = { text?: string; style?: string; onPress?: () => void };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRouter.canGoBack.mockReturnValue(true);
  mockedBusiness.mockReset();
  mockedBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedMenu.mockReset();
  mockedCurrencies.mockReset();
  mockedCurrencies.mockResolvedValue(CURRENCIES);
  mockedBegin.mockReset();
  mockedBegin.mockResolvedValue({ photo_id: 'ph-new', path: 'b1/ph-new.jpg' });
  mockedFinish.mockReset();
  mockedFinish.mockResolvedValue({ ...coverPhoto, id: 'ph-new', path: 'b1/ph-new.jpg' });
  mockedDeletePhoto.mockReset();
  mockedDeletePhoto.mockResolvedValue(undefined);
  mockedClaim.mockReset();
  mockedClaim.mockResolvedValue([]);
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
  );
  mockedUploadToBucket.mockReset();
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

describe('Photos screen: one upload at a time', () => {
  const addGallery = () => screen.getByRole('button', { name: /add.*gallery/i });
  const addMenuPhoto = () => screen.getByRole('button', { name: /add.*menu photo/i });
  const coverButton = () => screen.getByRole('button', { name: /(add|replace).*cover|uploading photo/i });

  it('ignores a second Add or the tile menu Replace while the cover upload is pending, and works again after', async () => {
    mockedMenu.mockResolvedValue(photosMenu);
    const upload = deferred<void>();
    mockedUploadToBucket.mockReturnValue(upload.promise);
    await renderUi(<BusinessPhotosScreen />);
    await screen.findByText('1 of 1');

    await fireEvent.press(coverButton());
    await waitFor(() => expect(mockedUploadToBucket).toHaveBeenCalledTimes(1));
    expect(mockedPick).toHaveBeenCalledTimes(1);

    // Every add control is disabled and starts nothing.
    for (const control of [addGallery(), addMenuPhoto(), coverButton()]) {
      expect(control.props.accessibilityState).toMatchObject({ disabled: true });
    }
    // Activate through the host's onClick too (a screen reader's double tap), since RNTL won't
    // press a disabled control.
    await act(async () => {
      addGallery().props.onClick?.({ stopPropagation: () => {}, nativeEvent: {} });
      addMenuPhoto().props.onClick?.({ stopPropagation: () => {}, nativeEvent: {} });
    });
    await fireEvent.press(addGallery());
    await fireEvent.press(addMenuPhoto());
    await fireEvent.press(coverButton());
    expect(mockedPick).toHaveBeenCalledTimes(1);

    // The tile menu's Replace option does nothing either.
    const alertsBefore = alertSpy.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: /^cover photo.*options/i }));
    if (alertSpy.mock.calls.length > alertsBefore) {
      const calls = alertSpy.mock.calls;
      const buttons = (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
      const replace = buttons.find((b) => /replace/i.test(String(b.text)));
      await act(async () => {
        replace?.onPress?.();
      });
    }
    expect(mockedPick).toHaveBeenCalledTimes(1);
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(mockedUploadToBucket).toHaveBeenCalledTimes(1);

    await act(async () => {
      upload.resolve();
    });
    await waitFor(() => expect(mockedFinish).toHaveBeenCalled());
    await waitFor(() => expect(addGallery()).toBeEnabled());
    expect(addMenuPhoto()).toBeEnabled();

    mockedUploadToBucket.mockResolvedValue(undefined);
    await fireEvent.press(addGallery());
    await waitFor(() => expect(mockedPick).toHaveBeenCalledTimes(2));
  });
});

describe('Item form: one upload at a time', () => {
  it('does not open the picker a second time while the item photo upload is pending', async () => {
    mockParams = { itemId: 'i2' };
    mockedMenu.mockResolvedValue(itemMenu);
    const upload = deferred<void>();
    mockedUploadToBucket.mockReturnValue(upload.promise);
    await renderUi(<MenuItemFormScreen mode="edit" />);

    await fireEvent.press(await screen.findByRole('button', { name: /^replace photo/i }));
    await waitFor(() => expect(mockedUploadToBucket).toHaveBeenCalledTimes(1));
    expect(mockedPick).toHaveBeenCalledTimes(1);

    const controls = screen.queryAllByRole('button', { name: /(add|replace) photo/i });
    for (const control of controls) {
      await act(async () => {
        control.props.onClick?.({ stopPropagation: () => {}, nativeEvent: {} });
      });
      await fireEvent.press(control);
    }
    expect(mockedPick).toHaveBeenCalledTimes(1);
    expect(mockedBegin).toHaveBeenCalledTimes(1);
    expect(mockedUploadToBucket).toHaveBeenCalledTimes(1);

    await act(async () => {
      upload.resolve();
    });
    await waitFor(() => expect(mockedFinish).toHaveBeenCalled());
  });
});
