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
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { getCurrencies } from '@/features/menu/api';
import { signedUrls } from '@/features/media/api';
import { mapArea } from '@/theme/tokens';

import {
  fetchHomemadeDetails,
  fetchHomemadeInBounds,
  fetchPinsInBounds,
  fetchRestaurantDetails,
  MapAppError,
} from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { HOMEMADE_AREA_NOTE } from '../homemadeText';
import { RATE_LIMITED_MESSAGE } from '../messages';
import { LARGE_PROMOTED_LIMIT } from '../promotedLayout';
import { CIRCLE_RADIUS_M } from '../region';
import type { HomemadeDetails, Pin, RestaurantDetails } from '../schema';

/* eslint-disable @typescript-eslint/no-require-imports */
const { __setIgnoreStopPropagation: ignoreStopPropagation } = require('react-native-maps') as {
  __setIgnoreStopPropagation: (value: boolean) => void;
};
/* eslint-enable @typescript-eslint/no-require-imports */

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

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: String.fromCodePoint(0x1f1ee, 0x1f1f9),
  icon: null,
  sort_order: 1,
};

// Oshawa, 0.1 degree across on a 390 point wide map: 3900 points per degree, so the 0.02 degree
// grid below puts promoted places about 78 points apart (more than the 60 point minimum).
const OSHAWA = { latitude: 43.9, longitude: -78.86, latitudeDelta: 0.1, longitudeDelta: 0.1 };
// Zoomed out: the same places are a few points apart, so only one can be large.
const OSHAWA_WIDE = { latitude: 43.9, longitude: -78.86, latitudeDelta: 2, longitudeDelta: 2 };
// Zoomed in enough for the homemade circle (latitudeDelta <= 0.05).
const OSHAWA_CLOSE = {
  latitude: 43.9,
  longitude: -78.86,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

const promotedGrid: Pin[] = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`,
  name: `Promoted ${i}`,
  cuisine_code: 'IT',
  lat: 43.88 + Math.floor(i / 5) * 0.03,
  lng: -78.9 + (i % 5) * 0.02,
  promoted: true,
}));
const organic: Pin = {
  id: 'o1',
  name: 'Casa Lisboa',
  cuisine_code: 'IT',
  lat: 43.91,
  lng: -78.87,
  promoted: false,
};
// A promoted cook at a point with awkward digits: the circle must use it exactly.
const cook: Pin = {
  id: 'h2',
  name: "Amara's Jollof Kitchen",
  cuisine_code: 'IT',
  lat: 43.90137,
  lng: -78.86229,
  promoted: true,
};

const restaurantDetails = (pin: Pin, sponsored: boolean): RestaurantDetails => ({
  id: pin.id,
  name: pin.name,
  cuisine_code: pin.cuisine_code,
  accepts_table_requests: false,
  public_address: '12 Simcoe St N, Oshawa',
  place_id: 'place-1',
  currency_code: null,
  sponsored,
  photos: [],
  items: [],
});
const homemadeDetails = (pin: Pin, sponsored: boolean): HomemadeDetails => ({
  id: pin.id,
  name: pin.name,
  cuisine_code: pin.cuisine_code,
  currency_code: null,
  sponsored,
  photos: [],
  items: [],
});

const clients: QueryClient[] = [];

async function renderTab(tab: 'restaurants' | 'homemade') {
  const client = new QueryClient(testClientOptions());
  clients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        {tab === 'restaurants' ? <RestaurantMapScreen /> : <HomemadeMapScreen />}
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('map-view');
  // The map's measured size: the large set is worked out on screen points.
  await fireEvent(screen.getByTestId('map-screen'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
  });
}

function moveMap(region: typeof OSHAWA) {
  return act(async () => {
    screen.getByTestId('map-view').props.onRegionChangeComplete(region);
  });
}

const largeMarkers = () => screen.queryAllByTestId('promoted-hit');
/** One of the large markers themselves (the Marker that holds a large marker's box). */
const aLargeMarker = () => {
  const found = screen
    .getAllByTestId('marker')
    .find((marker) => within(marker).queryByTestId('promoted-hit'));
  if (!found) throw new Error('no large marker');
  return found;
};
const ringedFlags = () => screen.queryAllByTestId('flag-ad-ring');
const sponsoredInSheet = () =>
  screen.queryByTestId('sponsored-label', { includeHiddenElements: true });

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  ignoreStopPropagation(false);
  jest.mocked(listCuisines).mockResolvedValue([italy]);
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest.mocked(signedUrls).mockResolvedValue({});
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'CA' }] as unknown as ReturnType<typeof getLocales>);
  jest
    .mocked(fetchPinsInBounds)
    .mockResolvedValue({ pins: [...promotedGrid, organic], capped: false, too_large: false });
  jest.mocked(fetchRestaurantDetails).mockImplementation(async (id) => {
    const pin = [...promotedGrid, organic].find((p) => p.id === id);
    return pin ? restaurantDetails(pin, pin.promoted) : null;
  });
  jest
    .mocked(fetchHomemadeInBounds)
    .mockResolvedValue({ pins: [cook], capped: false, too_large: false });
  jest.mocked(fetchHomemadeDetails).mockImplementation(async () => homemadeDetails(cook, true));
});

afterEach(async () => {
  await cleanup();
  for (const client of clients.splice(0)) client.clear();
  resetModuleMocks(
    '@/features/cuisines/api',
    '@/features/menu/api',
    '@/features/media/api',
    '../api',
  );
});

describe('Restaurants map: promoted places (spec 16)', () => {
  it('draws at most 8 large markers; the other promoted places get the ring at normal size', async () => {
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    expect(ringedFlags()).toHaveLength(promotedGrid.length - LARGE_PROMOTED_LIMIT);
    // The organic place keeps its plain flag.
    expect(screen.getByRole('button', { name: 'Casa Lisboa, Italy cuisine' })).toBeOnTheScreen();
    // Every promoted marker, large or ringed, says "sponsored".
    for (const pin of promotedGrid) {
      expect(
        screen.getByRole('button', { name: `${pin.name}, Italy cuisine, sponsored` }),
      ).toBeOnTheScreen();
    }
  });

  it('keeps large markers out of clusters when zoomed out, while ringed ones cluster', async () => {
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await moveMap(OSHAWA_WIDE);
    // Only one place can be large when they are a few points apart, and it is not in a cluster.
    await waitFor(() => expect(largeMarkers()).toHaveLength(1));
    const clusters = screen.getAllByTestId('cluster-circle');
    expect(clusters).toHaveLength(1);
    // The other 9 promoted places and the organic one are inside it.
    expect(
      screen.getByRole('button', { name: '10 places, double tap to zoom in' }),
    ).toBeOnTheScreen();
    expect(ringedFlags()).toHaveLength(0);
  });

  it('a press on a large marker opens its sheet; the press bubbling to the map does not close it', async () => {
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await fireEvent.press(aLargeMarker());
    expect(await screen.findByTestId('sheet-title')).toBeOnTheScreen();
  });

  it('keeps the sheet open on a platform that ignores stopPropagation (the map ignores marker presses)', async () => {
    ignoreStopPropagation(true);
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await fireEvent.press(aLargeMarker());
    expect(await screen.findByTestId('sheet-title')).toBeOnTheScreen();
  });

  it('shows "Sponsored" at the top of the sheet and in the title\'s spoken label', async () => {
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Promoted 0, Italy cuisine, sponsored' }),
    );
    expect(await screen.findByTestId('sheet-title')).toBeOnTheScreen();
    await waitFor(() => expect(fetchRestaurantDetails).toHaveBeenCalledWith('p0'));
    expect(sponsoredInSheet()).toBeTruthy();
    expect(screen.getByTestId('sheet-title').props.accessibilityLabel).toBe(
      'Promoted 0, sponsored',
    );
  });

  it('shows nothing of the kind for a place that is not promoted', async () => {
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Casa Lisboa, Italy cuisine' }),
    );
    expect(await screen.findByTestId('sheet-title')).toBeOnTheScreen();
    await waitFor(() => expect(fetchRestaurantDetails).toHaveBeenCalledWith('o1'));
    expect(sponsoredInSheet()).toBeNull();
    expect(screen.getByTestId('sheet-title').props.accessibilityLabel).toBeUndefined();
  });

  it('drops "Sponsored" from the sheet when the details say the campaign has ended', async () => {
    jest.mocked(fetchRestaurantDetails).mockImplementation(async (id) => {
      const pin = promotedGrid.find((p) => p.id === id);
      return pin ? restaurantDetails(pin, false) : null;
    });
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Promoted 0, Italy cuisine, sponsored' }),
    );
    await waitFor(() => expect(sponsoredInSheet()).toBeNull());
    expect(screen.getByTestId('sheet-title').props.accessibilityLabel).toBeUndefined();
  });

  it('drops "Sponsored" once the details say the place is not available', async () => {
    jest.mocked(fetchRestaurantDetails).mockResolvedValue(null);
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Promoted 0, Italy cuisine, sponsored' }),
    );
    await screen.findByText("This restaurant isn't available right now.");
    expect(sponsoredInSheet()).toBeNull();
    expect(screen.getByTestId('sheet-title').props.accessibilityLabel).toBeUndefined();
  });

  it('keeps "Sponsored" from the pin while the details load and when their request failed', async () => {
    let fail: (error: Error) => void = () => undefined;
    jest.mocked(fetchRestaurantDetails).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await renderTab('restaurants');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(LARGE_PROMOTED_LIMIT));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Promoted 0, Italy cuisine, sponsored' }),
    );
    // Loading: the pin's own flag.
    await waitFor(() => expect(fetchRestaurantDetails).toHaveBeenCalledWith('p0'));
    expect(sponsoredInSheet()).toBeTruthy();
    // Failed (unknown): still the pin's flag. rate_limited is never retried.
    await act(async () => fail(new MapAppError('rate_limited')));
    await screen.findByText(RATE_LIMITED_MESSAGE);
    expect(sponsoredInSheet()).toBeTruthy();
    expect(screen.getByTestId('sheet-title').props.accessibilityLabel).toBe(
      'Promoted 0, sponsored',
    );
  });
});

describe('Homemade map: promoted cooks (spec 16)', () => {
  it('draws the large marker and the same 500 m circle, centred exactly on the server point', async () => {
    await renderTab('homemade');
    await moveMap(OSHAWA_CLOSE);
    await waitFor(() => expect(largeMarkers()).toHaveLength(1));
    const circle = screen.getByTestId('map-circle');
    expect(circle.props.center).toEqual({ latitude: cook.lat, longitude: cook.lng });
    expect(circle.props.radius).toBe(CIRCLE_RADIUS_M);
    expect(CIRCLE_RADIUS_M).toBe(500);
    expect(circle.props.fillColor).toBe(mapArea.fill);
    expect(circle.props.strokeColor).toBe(mapArea.stroke);
    expect(circle.props.strokeWidth).toBe(mapArea.strokeWidth);
    expect(circle.props.zIndex).toBe(0);
    // The marker sits at the same server point: the float only moves its picture on screen.
    const marker = screen.getByRole('button', {
      name: "Amara's Jollof Kitchen, Italy cuisine, homemade, approximate area, sponsored",
    });
    expect(marker.props.coordinate).toEqual({ latitude: cook.lat, longitude: cook.lng });
  });

  it('draws no circle when zoomed out, promoted or not', async () => {
    await renderTab('homemade');
    await moveMap(OSHAWA);
    await waitFor(() => expect(largeMarkers()).toHaveLength(1));
    expect(screen.queryByTestId('map-circle')).toBeNull();
  });

  it('shows "Sponsored" and the approximate-area note in the sheet, and no address', async () => {
    await renderTab('homemade');
    await moveMap(OSHAWA_CLOSE);
    await waitFor(() => expect(largeMarkers()).toHaveLength(1));
    await fireEvent.press(
      screen.getByRole('button', {
        name: "Amara's Jollof Kitchen, Italy cuisine, homemade, approximate area, sponsored",
      }),
    );
    expect(await screen.findByText(HOMEMADE_AREA_NOTE)).toBeOnTheScreen();
    expect(sponsoredInSheet()).toBeTruthy();
    expect(screen.getByTestId('sheet-title').props.accessibilityLabel).toBe(
      "Amara's Jollof Kitchen, sponsored",
    );
    expect(screen.queryByText('Address')).toBeNull();
    expect(screen.queryByText(/Simcoe|Street|Road|Avenue/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Directions/ })).toBeNull();
  });
});
