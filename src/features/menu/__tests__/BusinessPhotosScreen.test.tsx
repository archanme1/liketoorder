import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
const homemade: MyBusiness = {
  ...restaurant,
  id: 'b2',
  type: 'homemade',
  name: "Gran's Kitchen",
  accepts_table_requests: false,
  public_address: null,
};

const HOMEMADE_NOTE =
  'Photos are public. Avoid showing your house number, front door or street sign.';

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
        <BusinessPhotosScreen />
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

const addCover = () => screen.getByRole('button', { name: /(add|replace).*cover/i });
const addGallery = () => screen.getByRole('button', { name: /add.*gallery/i });
const addMenu = () => screen.getByRole('button', { name: /add.*menu photo/i });

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

describe('BusinessPhotosScreen: the four states', () => {
  it('shows a skeleton while the photos load', async () => {
    mockedMenu.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(await screen.findByTestId('seller-skeleton')).toBeTruthy();
  });

  it('shows an error with retry, and the retry loads the photos', async () => {
    mockedMenu.mockRejectedValueOnce(new MenuAppError('network'));
    await renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Cover')).toBeTruthy();
    expect(mockedMenu).toHaveBeenCalledTimes(2);
  });

  it('shows "No photos yet" and empty counts when there are none', async () => {
    await renderScreen();
    expect(await screen.findByText('No photos yet')).toBeTruthy();
    expect(screen.getByText('0 of 1')).toBeTruthy();
    expect(screen.getByText('0 of 6')).toBeTruthy();
    expect(screen.getByText('0 of 10')).toBeTruthy();
    expect(addCover()).toBeEnabled();
    expect(addGallery()).toBeEnabled();
    expect(addMenu()).toBeEnabled();
  });

  it('shows the three sections with their counts on success', async () => {
    mockedMenu.mockResolvedValue(
      withPhotos([photo('c1', 'cover', null), ...gallery(3), ...menuPages(2)]),
    );
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Cover' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Gallery' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Menu photos' })).toBeTruthy();
    expect(screen.getByText('1 of 1')).toBeTruthy();
    expect(screen.getByText('3 of 6')).toBeTruthy();
    expect(screen.getByText('2 of 10')).toBeTruthy();
    expect(screen.queryByText('No photos yet')).toBeNull();
  });
});

describe('BusinessPhotosScreen: access (Decision 14)', () => {
  it('does not redirect while the business loads', async () => {
    mockedBusiness.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(await screen.findByTestId('seller-skeleton')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to onboarding after the business loads as null', async () => {
    mockedBusiness.mockResolvedValue(null);
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/seller/onboarding'));
  });

  it('lets an owner with seller mode off open the photos', async () => {
    mockedProfile.mockResolvedValue({ ...profile, is_seller: false });
    mockedBusiness.mockResolvedValue({ ...restaurant, is_listed: false });
    await renderScreen();
    expect(await screen.findByText('Cover')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe('BusinessPhotosScreen: limits', () => {
  it('keeps Add gallery photo enabled at 5', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(5)));
    await renderScreen();
    await screen.findByText('5 of 6');
    expect(addGallery()).toBeEnabled();
  });

  it('disables Add gallery photo at 6', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(6)));
    await renderScreen();
    expect(await screen.findByText('6 of 6')).toBeTruthy();
    const add = addGallery();
    expect(add).toBeDisabled();
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect(String(add.props.accessibilityHint ?? '').length).toBeGreaterThan(0);
    // The other sections are not affected.
    expect(addMenu()).toBeEnabled();
    expect(addCover()).toBeEnabled();

    await fireEvent.press(add);
    expect(mockedPick).not.toHaveBeenCalled();
  });

  it('disables Add menu photo at 10 and keeps it enabled at 9', async () => {
    mockedMenu.mockResolvedValue(withPhotos(menuPages(9)));
    const client = await renderScreen();
    expect(await screen.findByText('9 of 10')).toBeTruthy();
    expect(addMenu()).toBeEnabled();
    client.clear();
  });

  it('disables Add menu photo at 10', async () => {
    mockedMenu.mockResolvedValue(withPhotos(menuPages(10)));
    await renderScreen();
    expect(await screen.findByText('10 of 10')).toBeTruthy();
    const add = addMenu();
    expect(add).toBeDisabled();
    expect(String(add.props.accessibilityHint ?? '').length).toBeGreaterThan(0);
    expect(addGallery()).toBeEnabled();
  });

  it('shows the cover as 1 of 1 and offers to replace it, not to add a second', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null)]));
    await renderScreen();
    expect(await screen.findByText('1 of 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /replace.*cover/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^add.*cover/i })).toBeNull();
  });
});

describe('BusinessPhotosScreen: adding photos', () => {
  it('adds a gallery photo: picks, prepares, reserves, uploads the prepared bytes, finishes', async () => {
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(addGallery());

    await waitFor(() => expect(mockedFinish).toHaveBeenCalledWith('ph-new'));
    expect(mockedPrepare).toHaveBeenCalledWith('file:///picked.jpg');
    expect(mockedBegin.mock.calls[0][0]).toBe('gallery');
    expect(mockedUploadToBucket).toHaveBeenCalledWith(
      'business-media',
      'b1/ph-new.jpg',
      PREPARED_BYTES,
    );
    expect(mockedUploadToBucket.mock.calls[0][2]).toBe(PREPARED_BYTES);
    // The picker's URI never reaches Storage.
    expect(mockedUploadToBucket.mock.calls[0]).not.toContain('file:///picked.jpg');
  });

  it.each([
    ['menu', addMenu],
    ['cover', addCover],
  ] as const)('reserves a %s slot for that kind', async (kind, button) => {
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(button());
    await waitFor(() => expect(mockedBegin).toHaveBeenCalled());
    expect(mockedBegin.mock.calls[0][0]).toBe(kind);
  });

  it('reloads the photos after an upload', async () => {
    await renderScreen();
    await screen.findByText('0 of 6');
    mockedMenu.mockResolvedValue(withPhotos([photo('g1', 'gallery', 1)]));
    await fireEvent.press(addGallery());
    expect(await screen.findByText('1 of 6')).toBeTruthy();
  });

  it('does nothing more when the picker is cancelled', async () => {
    mockedPick.mockResolvedValue(null);
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(addGallery());
    await waitFor(() => expect(mockedPick).toHaveBeenCalled());
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedBegin).not.toHaveBeenCalled();
    expect(mockedUploadToBucket).not.toHaveBeenCalled();
  });

  it.each(['metadata_present', 'too_large'] as const)(
    'a photo that fails preparation (%s) reserves nothing, uploads nothing and shows an error',
    async (code) => {
      mockedPrepare.mockRejectedValue(new MediaError(code));
      await renderScreen();
      await screen.findByText('0 of 6');
      await fireEvent.press(addGallery());

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(mockedBegin).not.toHaveBeenCalled();
      expect(mockedUploadToBucket).not.toHaveBeenCalled();
      expect(mockedFinish).not.toHaveBeenCalled();
    },
  );

  it('shows a message when the server says the section is full (photo_limit)', async () => {
    mockedBegin.mockRejectedValue(new MenuAppError('photo_limit'));
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(addGallery());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockedUploadToBucket).not.toHaveBeenCalled();
  });

  it('frees the slot and cleans up when the upload fails', async () => {
    mockedUploadToBucket.mockRejectedValue(new MediaError('upload_failed'));
    mockedClaim
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['b1/ph-new.jpg'])
      .mockResolvedValue([]);
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(addGallery());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockedDeletePhoto).toHaveBeenCalledWith('ph-new');
    expect(mockedFinish).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/ph-new.jpg']),
    );
  });

  it('retries once on cleanup_required, running the cleanup between the two tries', async () => {
    mockedBegin
      .mockRejectedValueOnce(new MenuAppError('cleanup_required'))
      .mockResolvedValueOnce({ photo_id: 'ph-new', path: 'b1/ph-new.jpg' });
    mockedClaim
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['b1/old.jpg'])
      .mockResolvedValue([]);
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(addGallery());

    await waitFor(() => expect(mockedFinish).toHaveBeenCalledWith('ph-new'));
    expect(mockedBegin).toHaveBeenCalledTimes(2);
    expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/old.jpg']);
  });

  it('shows an error, with the button available to retry, after a second cleanup_required', async () => {
    mockedBegin.mockRejectedValue(new MenuAppError('cleanup_required'));
    await renderScreen();
    await screen.findByText('0 of 6');
    await fireEvent.press(addGallery());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mockedBegin).toHaveBeenCalledTimes(2);
    expect(mockedUploadToBucket).not.toHaveBeenCalled();
    expect(addGallery()).toBeEnabled();
  });

  it('runs the cleanup after replacing the cover and removes the replaced file', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null)]));
    mockedClaim
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['b1/c1.jpg'])
      .mockResolvedValue([]);
    await renderScreen();
    await screen.findByText('1 of 1');
    await fireEvent.press(screen.getByRole('button', { name: /replace.*cover/i }));

    await waitFor(() => expect(mockedFinish).toHaveBeenCalled());
    expect(mockedBegin.mock.calls[0][0]).toBe('cover');
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/c1.jpg']),
    );
  });
});

describe('BusinessPhotosScreen: removing photos', () => {
  it('removes a gallery photo after confirmation, then runs the cleanup', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(3)));
    mockedClaim
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['b1/g2.jpg'])
      .mockResolvedValue([]);
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    expect(alertSpy).toHaveBeenCalled();
    expect(mockedDeletePhoto).not.toHaveBeenCalled();

    await removeThroughAlerts();

    await waitFor(() => expect(mockedDeletePhoto).toHaveBeenCalledWith('g2'));
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/g2.jpg']),
    );
  });

  it('removes a menu photo', async () => {
    mockedMenu.mockResolvedValue(withPhotos(menuPages(2)));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: /menu photo 1 of 2.*options/i }),
    );
    await removeThroughAlerts();
    await waitFor(() => expect(mockedDeletePhoto).toHaveBeenCalledWith('m1'));
  });

  it('removes the cover', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null)]));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^cover photo.*options/i }));
    await removeThroughAlerts();
    await waitFor(() => expect(mockedDeletePhoto).toHaveBeenCalledWith('c1'));
  });

  it('removes nothing when the seller cancels', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(3)));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    expect(lastAlertButtons().some((b) => b.style === 'cancel')).toBe(true);
    expect(mockedDeletePhoto).not.toHaveBeenCalled();
  });

  it('shows a message when the delete fails', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(3)));
    mockedDeletePhoto.mockRejectedValue(new MenuAppError('network'));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Gallery photo 2 of 3. Opens photo options.' }),
    );
    await removeThroughAlerts();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('BusinessPhotosScreen: pending rows without a signed URL', () => {
  it('shows "Photo unavailable" for a cover whose URL is not available, not a broken tile', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null)]));
    mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, null])),
    );
    await renderScreen();
    expect(await screen.findByText('Photo unavailable')).toBeTruthy();
    expect(screen.queryByTestId('expo-image')).toBeNull();
  });

  it('shows "Photo unavailable" only for the photos without a URL', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(2)));
    mockedSignedUrls.mockImplementation(async (_b: string, paths: string[]) =>
      Object.fromEntries(
        paths.map((p) => [p, p === 'b1/g2.jpg' ? null : `https://signed.test/${p}`]),
      ),
    );
    await renderScreen();
    expect(await screen.findAllByText('Photo unavailable')).toHaveLength(1);
    expect(screen.getAllByTestId('expo-image')).toHaveLength(1);
  });

  it('shows each photo from its signed URL, cached by its stored path', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null)]));
    await renderScreen();
    const image = await screen.findByTestId('expo-image');
    expect(image.props.source).toEqual({
      uri: 'https://signed.test/b1/c1.jpg',
      cacheKey: 'b1/c1.jpg',
    });
    expect(image.props.cachePolicy).toBe('memory-disk');
  });
});

describe('BusinessPhotosScreen: the homemade note', () => {
  it('shows the note to a homemade seller', async () => {
    mockedBusiness.mockResolvedValue(homemade);
    await renderScreen();
    expect(await screen.findByText(HOMEMADE_NOTE)).toBeTruthy();
  });

  it('does not show it to a restaurant', async () => {
    await renderScreen();
    await screen.findByText('0 of 6');
    expect(screen.queryByText(HOMEMADE_NOTE)).toBeNull();
    expect(screen.queryByText(/house number/i)).toBeNull();
  });
});

describe('BusinessPhotosScreen: storage cleanup on open', () => {
  it('runs the cleanup when the screen opens and removes the returned paths', async () => {
    mockedClaim.mockResolvedValueOnce(['b1/queued.jpg']).mockResolvedValue([]);
    await renderScreen();
    await screen.findByText('0 of 6');
    await waitFor(() =>
      expect(mockedRemoveFromBucket).toHaveBeenCalledWith('business-media', ['b1/queued.jpg']),
    );
    expect(mockedClaim.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('opens normally when the cleanup fails (the removal is retried on the next open)', async () => {
    mockedClaim.mockResolvedValue(['b1/queued.jpg']);
    mockedRemoveFromBucket.mockRejectedValue(new MediaError('network'));
    await renderScreen();
    expect(await screen.findByText('0 of 6')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('BusinessPhotosScreen: accessible names (Decision 16)', () => {
  it('makes the gallery tiles buttons named "Gallery photo k of n. Opens photo options."', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(3)));
    await renderScreen();
    for (const k of [1, 2, 3]) {
      const tile = await screen.findByRole('button', {
        name: `Gallery photo ${k} of 3. Opens photo options.`,
      });
      expect(tile.props.accessibilityRole ?? 'button').toBe('button');
    }
  });

  it('makes the cover and menu tiles buttons too', async () => {
    mockedMenu.mockResolvedValue(withPhotos([photo('c1', 'cover', null), ...menuPages(2)]));
    await renderScreen();
    expect(await screen.findByRole('button', { name: /^cover photo.*options/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /menu photo 1 of 2.*options/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /menu photo 2 of 2.*options/i })).toBeTruthy();
  });

  it('gives every button an accessibility label', async () => {
    mockedMenu.mockResolvedValue(
      withPhotos([photo('c1', 'cover', null), ...gallery(2), ...menuPages(1)]),
    );
    await renderScreen();
    await screen.findByText('2 of 6');
    for (const button of screen.getAllByRole('button')) {
      expect(String(button.props.accessibilityLabel ?? '').length).toBeGreaterThan(0);
    }
  });

  it('shows the section counts as "n of N" text', async () => {
    mockedMenu.mockResolvedValue(withPhotos(gallery(4)));
    await renderScreen();
    expect(await screen.findByText('4 of 6')).toBeTruthy();
  });
});
