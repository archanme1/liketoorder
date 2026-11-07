import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { getLocales } from 'expo-localization';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';
import { getCurrencies } from '@/features/menu/api';

import {
  fetchHomemadeDetails,
  fetchHomemadeInBounds,
  fetchPinsInBounds,
  fetchRestaurantDetails,
} from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { HOMEMADE_AREA_NOTE } from '../homemadeText';
import type { DetailsItem, DetailsPhoto } from '../schema';

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

const pin = { id: 'b1', name: 'Rosa', cuisine_code: 'IT', lat: 46.6, lng: 2.5 };
const photos: DetailsPhoto[] = [
  { id: 'p1', kind: 'cover', path: 'b1/cover.jpg', position: null, menu_item_id: null },
  { id: 'p2', kind: 'gallery', path: 'b1/g1.jpg', position: 1, menu_item_id: null },
  { id: 'p3', kind: 'gallery', path: 'b1/g2.jpg', position: 2, menu_item_id: null },
  { id: 'p4', kind: 'menu', path: 'b1/m1.jpg', position: 1, menu_item_id: null },
  { id: 'p5', kind: 'menu', path: 'b1/m2.jpg', position: 2, menu_item_id: null },
  { id: 'p6', kind: 'item', path: 'b1/i1.jpg', position: null, menu_item_id: 'i1' },
];
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

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}
  >
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {ui}
    </SafeAreaProvider>
  </QueryClientProvider>
);

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  const answer = { pins: [pin], capped: false, too_large: false };
  jest.mocked(fetchPinsInBounds).mockResolvedValue(answer);
  jest.mocked(fetchHomemadeInBounds).mockResolvedValue(answer);
  jest.mocked(fetchRestaurantDetails).mockResolvedValue({
    id: 'b1',
    name: 'Rosa',
    cuisine_code: 'IT',
    accepts_table_requests: false,
    public_address: '1 King St',
    place_id: 'FAKE',
    currency_code: 'CAD',
    photos,
    items,
  });
  jest.mocked(fetchHomemadeDetails).mockResolvedValue({
    id: 'b1',
    name: 'Rosa',
    cuisine_code: 'IT',
    currency_code: 'CAD',
    photos,
    items,
  });
  jest.mocked(listCuisines).mockResolvedValue([]);
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
    );
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

const WIDTH = Dimensions.get('window').width;
const COVER: DetailsPhoto = photos[0];

function setPhotos(list: DetailsPhoto[]) {
  jest.mocked(fetchRestaurantDetails).mockResolvedValue({
    id: 'b1',
    name: 'Rosa',
    cuisine_code: 'IT',
    accepts_table_requests: false,
    public_address: '1 King St',
    place_id: 'FAKE',
    currency_code: 'CAD',
    photos: list,
    items,
  });
  jest.mocked(fetchHomemadeDetails).mockResolvedValue({
    id: 'b1',
    name: 'Rosa',
    cuisine_code: 'IT',
    currency_code: 'CAD',
    photos: list,
    items,
  });
}

async function openSheet(screenUi: React.ReactElement) {
  await render(wrap(screenUi));
  await fireEvent.press(await screen.findByRole('button', { name: /^Rosa/ }));
  await screen.findByText('Menu');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

// Where each landmark sits in the sheet's render order (top to bottom).
function at(needle: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(needle);
}
const BANNER = '"testID":"cover-banner"';
const SAFETY = '"testID":"homemade-disclaimer"';
const MENU_PAGES = '"testID":"menu-pages"';
const FIRST_ITEM = '"Pasta"';
const GALLERY = '"testID":"gallery-strip"';

function box(label: string, scope = screen) {
  const tile = scope.getByRole('image', { name: label });
  return StyleSheet.flatten(
    (tile.children[0] as unknown as { props: { style: never } }).props.style,
  );
}

describe('the menu-first order, both tabs', () => {
  describe.each([
    ['Restaurants', <RestaurantMapScreen key="r" />, '"Address"', false],
    ['Homemade', <HomemadeMapScreen key="h" />, HOMEMADE_AREA_NOTE, true],
  ])('%s sheet', (_tab, ui, bottom, homemade) => {
    beforeEach(() => setPhotos(photos));

    it('is: cover banner, menu pages, menu items, gallery, then the address or area note', async () => {
      await openSheet(ui);
      const order = [BANNER, MENU_PAGES, FIRST_ITEM, GALLERY, bottom].map(at);
      expect(order.every((index) => index > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it(
      homemade ? 'puts the small safety row between the banner and the menu' : 'has no safety row',
      async () => {
        await openSheet(ui);
        if (homemade) {
          expect(at(BANNER)).toBeLessThan(at(SAFETY));
          expect(at(SAFETY)).toBeLessThan(at(MENU_PAGES));
        } else {
          expect(at(SAFETY)).toBe(-1);
        }
      },
    );

    it('keeps the name, flag and cuisine in the fixed header, outside the scrolling content', async () => {
      jest
        .mocked(listCuisines)
        .mockResolvedValue([
          { kind: 'country', code: 'IT', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 1 },
        ]);
      await openSheet(ui);
      await screen.findByLabelText('Italy');
      expect(within(screen.getByTestId('sheet-scroll')).queryByTestId('sheet-title')).toBeNull();
      expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
      expect(screen.getByLabelText('Italy')).toBeOnTheScreen();
    });

    it('ends with the address or area note: nothing follows it', async () => {
      await openSheet(ui);
      const after = JSON.stringify(screen.toJSON()).slice(at(bottom));
      expect(after).not.toContain(GALLERY);
      expect(after).not.toContain(MENU_PAGES);
      expect(after).not.toContain(BANNER);
    });

    it('shows the cover as a short banner (88 pt, full width) and menu pages as 96 pt thumbnails', async () => {
      await openSheet(ui);
      const banner = box('Rosa, photo 1 of 3');
      expect(banner.height).toBe(88);
      expect(banner.width).toBe('100%');
      const page = box('Rosa, menu page 1 of 2');
      expect(page.height).toBe(96);
      expect(page.width).toBe(96);
      const gallery = box('Rosa, photo 2 of 3');
      expect(gallery.height).toBe(160);
    });

    it('shows no banner and no placeholder when there is no cover', async () => {
      setPhotos(photos.filter((photo) => photo.kind !== 'cover'));
      await openSheet(ui);
      expect(at(BANNER)).toBe(-1);
      expect(screen.queryByText('No photos yet')).toBeNull();
      expect(at(GALLERY)).toBeGreaterThan(-1);
      // The gallery photos are now 1 and 2 of 2.
      expect(screen.getByRole('image', { name: 'Rosa, photo 1 of 2' })).toBeOnTheScreen();
    });

    it('shows the banner and no gallery row and no placeholder when there is only a cover', async () => {
      setPhotos([COVER]);
      await openSheet(ui);
      expect(at(BANNER)).toBeGreaterThan(-1);
      expect(at(GALLERY)).toBe(-1);
      expect(screen.queryByText('No photos yet')).toBeNull();
    });

    it('shows "No photos yet" only when there is neither a cover nor a gallery, in the gallery place', async () => {
      setPhotos(photos.filter((photo) => photo.kind === 'menu' || photo.kind === 'item'));
      await openSheet(ui);
      expect(at(BANNER)).toBe(-1);
      expect(screen.getByText('No photos yet')).toBeOnTheScreen();
      expect(at(FIRST_ITEM)).toBeLessThan(at('"No photos yet"'));
      expect(at('"No photos yet"')).toBeLessThan(at(bottom));
    });

    it('pages the banner and the gallery in ONE viewer; the menu pages keep their own', async () => {
      await openSheet(ui);
      await fireEvent.press(
        screen.getByRole('button', { name: 'Rosa, photo 1 of 3. Opens photo viewer.' }),
      );
      expect(await screen.findByText('Photo 1 of 3')).toBeOnTheScreen();
      await fireEvent(await screen.findByTestId('photo-viewer-list'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: WIDTH * 2, y: 0 } },
      });
      expect(await screen.findByText('Photo 3 of 3')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Close photo' }));
      expect(screen.queryByTestId('photo-viewer')).toBeNull();
      expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();

      await fireEvent.press(
        screen.getByRole('button', { name: 'Rosa, menu page 1 of 2. Opens photo viewer.' }),
      );
      expect(await screen.findByText('Photo 1 of 2')).toBeOnTheScreen();
    });
  });
});

describe('what the half snap shows (token arithmetic, not a device measurement)', () => {
  // The scroll area at the half snap is about 280 pt on an 844 pt phone (spec 08, Decision 15).
  // This only checks the sizes the estimate is built from; the real layout is a Simulator check.
  it('is built from an 88 pt banner, a 44 pt safety row and 96 pt menu thumbnails', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { size } = require('@/theme/tokens') as { size: Record<string, number> };
    expect(size.coverBanner).toBe(88);
    expect(size.touch).toBe(44);
    expect(size.photoThumb).toBe(96);
  });
});
