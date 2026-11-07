import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
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

async function openSheet(screenUi: React.ReactElement) {
  await render(wrap(screenUi));
  await fireEvent.press(await screen.findByRole('button', { name: /^Rosa/ }));
  await screen.findByText('Menu');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

describe.each([
  ['Restaurants', <RestaurantMapScreen key="r" />],
  ['Homemade', <HomemadeMapScreen key="h" />],
])('%s tab: photos in the sheet open the viewer', (_tab, ui) => {
  it('tapping the cover opens the viewer on photo 1, which pages through cover and gallery', async () => {
    await openSheet(ui);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Rosa, photo 1 of 3. Opens photo viewer.' }),
    );
    expect(await screen.findByText('Photo 1 of 3')).toBeOnTheScreen();
    expect(screen.getByTestId('photo-viewer')).toBeOnTheScreen();
  });

  it('tapping the second gallery photo opens on it', async () => {
    await openSheet(ui);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Rosa, photo 3 of 3. Opens photo viewer.' }),
    );
    expect(await screen.findByText('Photo 3 of 3')).toBeOnTheScreen();
  });

  it('keeps the tile\'s own "photo n of m" image label', async () => {
    await openSheet(ui);
    expect(screen.getByRole('image', { name: 'Rosa, photo 1 of 3' })).toBeOnTheScreen();
  });

  it('menu pages open their own viewer, counted among the menu pages only', async () => {
    await openSheet(ui);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Rosa, menu page 2 of 2. Opens photo viewer.' }),
    );
    expect(await screen.findByText('Photo 2 of 2')).toBeOnTheScreen();
  });

  it('closing the viewer returns to the same open sheet', async () => {
    await openSheet(ui);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Rosa, photo 1 of 3. Opens photo viewer.' }),
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Close photo' }));
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
  });

  it('item thumbnails stay non-tappable', async () => {
    await openSheet(ui);
    expect(screen.getByRole('image', { name: 'Photo of Pasta' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Photo of Pasta/ })).toBeNull();
  });
});
