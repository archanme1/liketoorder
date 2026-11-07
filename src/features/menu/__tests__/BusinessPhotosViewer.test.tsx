import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
  getMenu,
} from '../api';
import { BusinessPhotosScreen } from '../components/BusinessPhotosScreen';
import type { BusinessPhoto, Menu } from '../schema';

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
let mockParams: { section?: string } = {};
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
const mockedBegin = beginPhotoUpload as unknown as jest.Mock;
const mockedFinish = finishPhotoUpload as unknown as jest.Mock;
const mockedDeletePhoto = deleteBusinessPhoto as unknown as jest.Mock;
const mockedClaim = claimPhotoCleanup as unknown as jest.Mock;
const mockedSignedUrls = signedUrls as unknown as jest.Mock;
const mockedUploadToBucket = uploadToBucket as unknown as jest.Mock;
const mockedRemoveFromBucket = removeFromBucket as unknown as jest.Mock;
const mockedPick = pickImage as unknown as jest.Mock;
const mockedPrepare = prepareImage as unknown as jest.Mock;

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
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};

function photo(id: string, kind: BusinessPhoto['kind'], position: number | null): BusinessPhoto {
  return { id, business_id: 'b1', kind, menu_item_id: null, path: `b1/${id}.jpg`, position };
}
function gallery(count: number): BusinessPhoto[] {
  return Array.from({ length: count }, (_, i) => photo(`g${i + 1}`, 'gallery', i + 1));
}
function menuPages(count: number): BusinessPhoto[] {
  return Array.from({ length: count }, (_, i) => photo(`m${i + 1}`, 'menu', i + 1));
}
const withPhotos = (photos: BusinessPhoto[]): Menu => ({ items: [], photos });

const PREPARED_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

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
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 47, left: 0, right: 0, bottom: 34 },
          }}
        >
          <BusinessPhotosScreen />
        </SafeAreaProvider>
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
async function pressLastDestructive() {
  const button = lastAlertButtons().find((b) => b.style === 'destructive');
  expect(button).toBeDefined();
  await act(async () => {
    button?.onPress?.();
  });
}
// Removing may take an options sheet and then a confirmation; press the destructive button of each.
async function removeThroughAlerts() {
  const before = alertSpy.mock.calls.length;
  await pressLastDestructive();
  if (alertSpy.mock.calls.length > before) await pressLastDestructive();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockedBusiness.mockReset();
  mockedBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedMenu.mockReset();
  mockedMenu.mockResolvedValue(withPhotos([]));
  mockedBegin.mockReset();
  mockedBegin.mockResolvedValue({ photo_id: 'ph-new', path: 'b1/ph-new.jpg' });
  mockedFinish.mockReset();
  mockedFinish.mockResolvedValue(photo('ph-new', 'gallery', 1));
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
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

function chooseOption(label: string) {
  const button = lastAlertButtons().find((b) => b.text === label);
  if (!button?.onPress) throw new Error(`No "${label}" option in the photo options`);
  return act(async () => button.onPress!());
}

const gallery2 = () => gallery(3);

describe('BusinessPhotosScreen: "View larger" (spec 08)', () => {
  it('adds "View larger" as the first option of the existing photo options, keeping Remove and Cancel', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery2()));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    const texts = lastAlertButtons().map((b) => b.text);
    expect(texts[0]).toBe('View larger');
    expect(texts).toContain('Remove');
    expect(lastAlertButtons().some((b) => b.style === 'cancel')).toBe(true);
  });

  it('a tile press still opens the options, not the viewer', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery2()));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });

  it('"View larger" opens the viewer on that photo, among all the photos in page order', async () => {
    mockedMenu.mockResolvedValue(
      withPhotos([photo('c1', 'cover', null), ...gallery2(), ...menuPages(2)]),
    );
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    await chooseOption('View larger');
    // cover (1), gallery 1-3 (2-4), menu 1-2 (5-6): the second gallery photo is the 3rd page.
    expect(await screen.findByText('Photo 3 of 6')).toBeOnTheScreen();
  });

  it('the cover offers "View larger" next to Replace and Remove', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null)]));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^cover photo.*options/i }));
    const texts = lastAlertButtons().map((b) => b.text);
    expect(texts).toEqual(expect.arrayContaining(['View larger', 'Replace', 'Remove']));
    await chooseOption('View larger');
    expect(await screen.findByText('Photo 1 of 1')).toBeOnTheScreen();
  });

  it('closing the viewer leaves the Photos screen as it was', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery2()));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    await chooseOption('View larger');
    await fireEvent.press(await screen.findByRole('button', { name: 'Close photo' }));
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
    expect(screen.getByText('3 of 6')).toBeTruthy();
    expect(mockedDeletePhoto).not.toHaveBeenCalled();
  });

  it('does not offer "View larger" for a photo that has no link (nothing to show)', async () => {
    mockedSignedUrls.mockImplementation(async (_bucket: string, paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, null])),
    );
    mockedMenu.mockResolvedValue(withPhotos(gallery2()));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: /Gallery photo 2 of 3. Opens photo options./ }),
    );
    expect(lastAlertButtons().map((b) => b.text)).not.toContain('View larger');
  });

  it('removing still works from the same options (editing is not lost)', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery2()));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    await removeThroughAlerts();
    await waitFor(() => expect(mockedDeletePhoto).toHaveBeenCalledWith('g2'));
  });
});
