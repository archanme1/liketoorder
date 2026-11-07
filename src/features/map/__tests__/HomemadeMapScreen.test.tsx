import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { getCurrencies } from '@/features/menu/api';
import { signedUrls } from '@/features/media/api';

import { fetchHomemadeDetails, fetchHomemadeInBounds, fetchPinsInBounds } from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import type { Pin, PinsResponse } from '../schema';

/* eslint-disable @typescript-eslint/no-require-imports */
const { __animateToRegion: animateToRegion, __setIgnoreStopPropagation: ignoreStopPropagation } =
  require('react-native-maps') as {
    __animateToRegion: jest.Mock;
    __setIgnoreStopPropagation: (value: boolean) => void;
  };
const { __snapToIndex: snapToIndex } = require('@gorhom/bottom-sheet') as {
  __snapToIndex: jest.Mock;
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
  fetchHomemadeInBounds: jest.fn(),
  fetchHomemadeDetails: jest.fn(),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const fetchCooks = jest.mocked(fetchHomemadeInBounds);
const fetchRestaurants = jest.mocked(fetchPinsInBounds);
const fetchDetails = jest.mocked(fetchHomemadeDetails);

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 1,
};
// Inside the France opening view (46.6, 2.5).
const rosa: Pin = { id: 'h1', name: "Nonna Rosa's Table", cuisine_code: 'IT', lat: 46.6, lng: 2.5 };
const answer = (pins: Pin[], extra: Partial<PinsResponse> = {}): PinsResponse => ({
  pins,
  capped: false,
  too_large: false,
  ...extra,
});

const ZOOMED_IN = { latitude: 46.6, longitude: 2.5, latitudeDelta: 0.03, longitudeDelta: 0.03 };
// A different box that still shows the cook, so a failed answer for it can be seen to keep the flag.
const NEARBY = { latitude: 46.5, longitude: 2.6, latitudeDelta: 1, longitudeDelta: 1 };
const ZOOMED_OUT = { latitude: 46.6, longitude: 2.5, latitudeDelta: 2, longitudeDelta: 2 };

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  return (
    <QueryClientProvider client={queryClient}>
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
}

async function renderScreen() {
  await render(wrap(<HomemadeMapScreen />));
  await screen.findByTestId('map-view');
}

// Let the sheet's details answer (null here), so no update lands after the test ends.
async function sheetSettled() {
  await screen.findByText("This cook isn't available right now.");
}

function moveMap(region: typeof ZOOMED_IN) {
  return act(async () => {
    screen.getByTestId('map-view').props.onRegionChangeComplete(region);
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  animateToRegion.mockClear();
  snapToIndex.mockClear();
  ignoreStopPropagation(false);
  fetchCooks.mockReset();
  fetchCooks.mockResolvedValue(answer([rosa]));
  fetchRestaurants.mockReset();
  fetchRestaurants.mockResolvedValue(answer([]));
  fetchDetails.mockReset();
  fetchDetails.mockResolvedValue(null);
  jest.mocked(listCuisines).mockResolvedValue([italy]);
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest.mocked(signedUrls).mockResolvedValue({});
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

describe('HomemadeMapScreen: the map and its pins', () => {
  it('shows a Google map with the homemade label, for a guest, and asks only for homemade pins', async () => {
    await renderScreen();
    const map = screen.getByTestId('map-view');
    expect(map.props.provider).toBe('google');
    expect(map.props.accessibilityLabel).toBe('Homemade map');
    await waitFor(() => expect(fetchCooks).toHaveBeenCalledTimes(1));
    expect(fetchRestaurants).not.toHaveBeenCalled();
  });

  it('draws each cook as a flag named "homemade, approximate area"', async () => {
    await renderScreen();
    expect(
      await screen.findByRole('button', {
        name: "Nonna Rosa's Table, Italy cuisine, homemade, approximate area",
      }),
    ).toBeOnTheScreen();
  });

  it('keeps its last viewed area apart from the Restaurants tab', async () => {
    await renderScreen();
    await moveMap(ZOOMED_IN);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('map.lastRegion.homemade')).not.toBeNull();
    });
    expect(await AsyncStorage.getItem('map.lastRegion')).toBeNull();
  });

  it('says "Loading homemade cooks" while it loads, then hides it', async () => {
    let resolve!: (value: PinsResponse) => void;
    fetchCooks.mockReturnValue(new Promise((res) => (resolve = res)));
    await renderScreen();
    expect(
      await screen.findByRole('progressbar', { name: 'Loading homemade cooks' }),
    ).toBeOnTheScreen();
    await act(async () => resolve(answer([rosa])));
    await waitFor(() =>
      expect(screen.queryByRole('progressbar', { name: 'Loading homemade cooks' })).toBeNull(),
    );
  });

  it('says "No homemade cooks here yet" for an empty area', async () => {
    fetchCooks.mockResolvedValue(answer([]));
    await renderScreen();
    expect(await screen.findByText('No homemade cooks here yet')).toBeOnTheScreen();
    expect(screen.getByText('Zoom out or move the map to look further.')).toBeOnTheScreen();
  });

  it('shows an error with Retry, keeps the old flags, and retries on request', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Nonna Rosa/ });
    fetchCooks.mockRejectedValue(Object.assign(new Error('x'), { code: 'network' }));
    await moveMap(NEARBY);
    expect(
      await screen.findByText(
        'No connection. Check your internet and try again.',
        {},
        { timeout: 3000 },
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeOnTheScreen();
    fetchCooks.mockResolvedValue(answer([rosa]));
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  });

  it('says "Try again in a moment" for a rate limit, keeps the flags, and does not retry by itself', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Nonna Rosa/ });
    fetchCooks.mockRejectedValue(
      Object.assign(new Error('rate_limited'), { code: 'rate_limited' }),
    );
    await moveMap(NEARBY);
    expect(
      await screen.findByText('Try again in a moment', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Nonna Rosa/ })).toBeOnTheScreen();
    const calls = fetchCooks.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fetchCooks.mock.calls.length).toBe(calls);
  });

  it('says "Zoom in to see more" when the answer is capped', async () => {
    fetchCooks.mockResolvedValue(answer([rosa], { capped: true }));
    await renderScreen();
    expect(await screen.findByText('Zoom in to see more')).toBeOnTheScreen();
  });

  it('says "Zoom in to see homemade cooks" when the server says the view is too large', async () => {
    fetchCooks.mockResolvedValue(answer([], { too_large: true }));
    await renderScreen();
    expect(await screen.findByText('Zoom in to see homemade cooks')).toBeOnTheScreen();
  });
});

describe('HomemadeMapScreen: circles', () => {
  it('draws one 500 m circle per flag when zoomed in, and none when zoomed out', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Nonna Rosa/ });
    expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen(); // opening view is wide
    await moveMap(ZOOMED_IN);
    const circle = await screen.findByTestId('map-circle');
    expect(circle.props.radius).toBe(500);
    expect(circle.props.center).toEqual({ latitude: rosa.lat, longitude: rosa.lng });
    await moveMap(ZOOMED_OUT);
    await waitFor(() => expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen());
  });

  it('draws the circle at 0.05 and not above it', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Nonna Rosa/ });
    await moveMap({ ...ZOOMED_IN, latitudeDelta: 0.05, longitudeDelta: 0.05 });
    expect(await screen.findByTestId('map-circle')).toBeOnTheScreen();
    await moveMap({ ...ZOOMED_IN, latitudeDelta: 0.0501, longitudeDelta: 0.0501 });
    await waitFor(() => expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen());
  });

  it('never draws a circle for pins that are grouped into a cluster', async () => {
    const stack: Pin[] = ['a', 'b', 'c'].map((id, i) => ({
      id,
      name: `Cook ${id}`,
      cuisine_code: 'IT',
      lat: 47 + i * 0.0001,
      lng: 3 + i * 0.0001,
    }));
    fetchCooks.mockResolvedValue(answer(stack));
    await renderScreen();
    expect(
      await screen.findByRole('button', { name: /places, double tap to zoom in/ }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen();
  });
});

describe('HomemadeMapScreen: taps', () => {
  it('keeps the sheet open after a flag tap, although the press bubbles towards the map, and does not move the map', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Nonna Rosa/ }));
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
    expect(animateToRegion).not.toHaveBeenCalled();
    await sheetSettled();
  });

  it('still keeps it open on a platform that ignores stopPropagation (the map ignores bubbled marker presses)', async () => {
    ignoreStopPropagation(true);
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Nonna Rosa/ }));
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
    await sheetSettled();
  });

  it('a tap inside a circle is a plain map press: it clears the selection', async () => {
    await renderScreen();
    await moveMap(ZOOMED_IN);
    await fireEvent.press(await screen.findByRole('button', { name: /Nonna Rosa/ }));
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
    await sheetSettled();
    // What the platforms report for a tap that lands inside a circle: no marker, so a map press.
    await act(async () => screen.getByTestId('map-view').props.onPress({ nativeEvent: {} }));
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
    await act(async () =>
      screen.getByTestId('map-view').props.onPress({ nativeEvent: { action: 'press' } }),
    );
  });

  it('a cluster tap zooms in and does not open a sheet', async () => {
    const stack: Pin[] = ['a', 'b', 'c'].map((id, i) => ({
      id,
      name: `Cook ${id}`,
      cuisine_code: 'IT',
      lat: 47 + i * 0.0001,
      lng: 3 + i * 0.0001,
    }));
    fetchCooks.mockResolvedValue(answer(stack));
    await renderScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: /places, double tap to zoom in/ }),
    );
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });
});

describe('HomemadeMapScreen: Places in this area', () => {
  it('lists the cooks, and picking one moves the camera and stacks the sheet on the list', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Nonna Rosa/ });
    await fireEvent.press(screen.getByRole('button', { name: 'Places in this area' }));
    expect(screen.getByText('Homemade cooks in this area')).toBeOnTheScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: "Nonna Rosa's Table, Italy cuisine" }),
    );
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeOnTheScreen();
    await sheetSettled();
    // (The X, and the "not available" panel's own button in this test, are both "Back to list".)
    await fireEvent.press(screen.getAllByRole('button', { name: 'Back to list' })[0]);
    expect(screen.getByText('Homemade cooks in this area')).toBeOnTheScreen();
  });

  it('says so when there are no cooks to list', async () => {
    fetchCooks.mockResolvedValue(answer([]));
    await renderScreen();
    await screen.findByText('No homemade cooks here yet');
    await fireEvent.press(screen.getByRole('button', { name: 'Places in this area' }));
    expect(
      await screen.findByText('No homemade cooks shown here. Zoom in or move the map.'),
    ).toBeOnTheScreen();
  });
});

describe('the Restaurants tab is not changed by the Homemade one', () => {
  it('Restaurants still asks for restaurants, labels its map and draws no circles', async () => {
    fetchRestaurants.mockResolvedValue(answer([rosa]));
    await render(wrap(<RestaurantMapScreen />));
    await screen.findByTestId('map-view');
    expect(screen.getByTestId('map-view').props.accessibilityLabel).toBe('Restaurants map');
    await moveMap(ZOOMED_IN);
    expect(
      await screen.findByRole('button', { name: "Nonna Rosa's Table, Italy cuisine" }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen();
    expect(fetchCooks).not.toHaveBeenCalled();
  });
});

describe('the location note', () => {
  it('names restaurants and homemade cooks and keeps the privacy promise', async () => {
    await AsyncStorage.removeItem('map.locationPromptDismissed');
    await renderScreen();
    expect(
      await screen.findByText('Show restaurants and homemade cooks near you?'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        /Your exact location stays on your phone\. We only receive the map area you're looking at\./,
      ),
    ).toBeOnTheScreen();
  });
});
