import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { getLocales } from 'expo-localization';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { getCountryView } from '../countryViews';
import * as lastRegion from '../lastRegion';
import { useMapConfigured } from '../mapConfig';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __animateToRegion: animateToRegion } = require('react-native-maps') as {
  __animateToRegion: jest.Mock;
};

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(async () => []),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const services = jest.mocked(Location.hasServicesEnabledAsync);
const getPermission = jest.mocked(Location.getForegroundPermissionsAsync);
const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const getPosition = jest.mocked(Location.getCurrentPositionAsync);
const mockedConfigured = jest.mocked(useMapConfigured);
const db = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };

function permission(status: string, canAskAgain = true) {
  getPermission.mockResolvedValue({
    status,
    canAskAgain,
    granted: status === 'granted',
  } as Location.LocationPermissionResponse);
}

async function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const result = await render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <RestaurantMapScreen />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('map-view');
  return result;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  animateToRegion.mockClear();
  getPermission.mockClear();
  requestPermission.mockClear();
  getPosition.mockReset();
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: { pins: [], capped: false, too_large: false }, error: null });
  mockedConfigured.mockReturnValue(true);
  services.mockResolvedValue(true);
  permission('undetermined');
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

describe('RestaurantMapScreen: the map', () => {
  it('shows a Google map to everyone, centred on the phone country', async () => {
    await renderScreen();
    const map = screen.getByTestId('map-view');
    expect(map.props.provider).toBe('google');
    expect(map.props.initialRegion).toEqual(getCountryView('FR'));
    expect(map.props.accessibilityLabel).toBe('Restaurants map');
  });

  it("hides Google's own business labels with exactly one style rule, and nothing else", async () => {
    await renderScreen();
    const style = screen.getByTestId('map-view').props.customMapStyle;
    expect(style).toEqual([{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }]);
  });

  it('opens on the world map with a "Zoom in" note when nothing else is known', async () => {
    jest
      .mocked(getLocales)
      .mockReturnValue([{ regionCode: null }] as unknown as ReturnType<typeof getLocales>);
    await renderScreen();
    expect(screen.getByText('Zoom in to see restaurants')).toBeOnTheScreen();
  });

  it('shows no "Zoom in" note on a country view', async () => {
    await renderScreen();
    expect(screen.queryByText('Zoom in to see restaurants')).not.toBeOnTheScreen();
  });

  it('opens on the last viewed region when one was saved', async () => {
    const saved = { latitude: 3, longitude: 4, latitudeDelta: 0.3, longitudeDelta: 0.3 };
    await AsyncStorage.setItem('map.lastRegion', JSON.stringify(saved));
    await renderScreen();
    expect(screen.getByTestId('map-view').props.initialRegion).toEqual(saved);
  });

  it('shows the zoom note when the person zooms out past the server limit', async () => {
    await renderScreen();
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        latitude: 0,
        longitude: 0,
        latitudeDelta: 100,
        longitudeDelta: 100,
      });
    });
    expect(screen.getByText('Zoom in to see restaurants')).toBeOnTheScreen();
  });
});

describe('RestaurantMapScreen: not configured', () => {
  it('shows "Map isn\'t configured" with the variable name in development, and no map', async () => {
    mockedConfigured.mockReturnValue(false);
    await render(<RestaurantMapScreen />);
    expect(screen.getByText("Map isn't configured")).toBeOnTheScreen();
    expect(screen.getByText(/EXPO_PUBLIC_GOOGLE_MAPS_(IOS|ANDROID)_KEY/)).toBeOnTheScreen();
    expect(screen.queryByTestId('map-view')).not.toBeOnTheScreen();
    expect(getPermission).not.toHaveBeenCalled();
  });
});

describe('RestaurantMapScreen: location flow', () => {
  it('shows the plain-language note first, and "Not now" hides it for good', async () => {
    await renderScreen();
    expect(await screen.findByText(/Your exact location stays on your phone/)).toBeOnTheScreen();
    expect(requestPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Your exact location stays on your phone/)).not.toBeOnTheScreen();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('map.locationPromptDismissed')).toBe('1');
  });

  it('does not show the note again after "Not now", but locate-me still works', async () => {
    await AsyncStorage.setItem('map.locationPromptDismissed', '1');
    await renderScreen();
    await act(async () => undefined);
    expect(screen.queryByText(/Your exact location stays on your phone/)).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Locate me' })).toBeOnTheScreen();
  });

  it('"Use my location" shows the system prompt, then centres on the person', async () => {
    await renderScreen();
    await screen.findByText(/Your exact location stays on your phone/);
    requestPermission.mockImplementationOnce(async () => {
      permission('granted');
      return { status: 'granted', canAskAgain: true, granted: true } as never;
    });
    getPosition.mockResolvedValue({
      coords: { latitude: 48.85, longitude: 2.35 },
    } as Location.LocationObject);
    await fireEvent.press(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() =>
      expect(animateToRegion).toHaveBeenCalledWith(
        { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        expect.any(Number),
      ),
    );
  });

  it('opens at once and moves to the person when already allowed', async () => {
    permission('granted');
    getPosition.mockResolvedValue({
      coords: { latitude: 1.5, longitude: 2.5 },
    } as Location.LocationObject);
    await renderScreen();
    await waitFor(() => expect(animateToRegion).toHaveBeenCalled());
    expect(animateToRegion.mock.calls[0][0]).toMatchObject({ latitude: 1.5, longitude: 2.5 });
    // No permission note when already allowed.
    expect(screen.queryByText(/Your exact location stays on your phone/)).not.toBeOnTheScreen();
  });

  it('is not blocked by a slow position: the map is on screen and does not move', async () => {
    jest.useFakeTimers();
    try {
      permission('granted');
      getPosition.mockReturnValue(new Promise(() => undefined));
      await renderScreen();
      expect(screen.getByTestId('map-view')).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(5000); // the 5 s timeout passes with no fix
      });
      expect(screen.getByTestId('map-view')).toBeOnTheScreen();
      expect(animateToRegion).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('locate-me recentres when allowed', async () => {
    permission('granted');
    getPosition.mockResolvedValue({
      coords: { latitude: 9, longitude: 8 },
    } as Location.LocationObject);
    await renderScreen();
    await waitFor(() => expect(animateToRegion).toHaveBeenCalledTimes(1));
    getPosition.mockResolvedValue({
      coords: { latitude: 7, longitude: 6 },
    } as Location.LocationObject);
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    await waitFor(() => expect(animateToRegion).toHaveBeenCalledTimes(2));
    expect(animateToRegion.mock.calls[1][0]).toMatchObject({ latitude: 7, longitude: 6 });
  });

  it('locate-me explains when no position can be found', async () => {
    permission('granted');
    getPosition.mockRejectedValue(new Error('no fix'));
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    expect(await screen.findByText(/couldn't find your location/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeOnTheScreen();
  });

  it('denied forever: explains and "Open Settings" opens Settings', async () => {
    permission('denied', false);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    expect(
      await screen.findByText('Location is off for LikeToOrder. You can turn it on in Settings.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/Location is off for LikeToOrder/)).not.toBeOnTheScreen();
  });

  it('moves to the position even when the fix lands before the map is on screen', async () => {
    permission('granted');
    getPosition.mockResolvedValue({
      coords: { latitude: 7, longitude: 6 },
    } as Location.LocationObject);
    // The saved opening view is slow to read, so the position arrives first.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = jest.spyOn(lastRegion, 'readLastRegion').mockImplementation(async () => {
      await held;
      return null;
    });
    try {
      const queryClient = new QueryClient();
      await render(
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width: 390, height: 844 },
              insets: { top: 47, left: 0, right: 0, bottom: 34 },
            }}
          >
            <RestaurantMapScreen />
          </SafeAreaProvider>
        </QueryClientProvider>,
      );
      // The fix has been read while the map is still loading.
      await waitFor(() => expect(getPosition).toHaveBeenCalled());
      expect(screen.queryByTestId('map-view')).not.toBeOnTheScreen();
      expect(animateToRegion).not.toHaveBeenCalled();
      await act(async () => release());
      await screen.findByTestId('map-view');
      await waitFor(() => expect(animateToRegion).toHaveBeenCalled());
      expect(animateToRegion.mock.calls.at(-1)?.[0]).toMatchObject({ latitude: 7, longitude: 6 });
      await act(async () => {});
    } finally {
      slow.mockRestore();
    }
  });

  it('locate-me reads the permission fresh: back from Settings with location on, it moves', async () => {
    permission('denied', false);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    expect(await screen.findByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    animateToRegion.mockClear();

    // The person turned location on in Settings and came back.
    permission('granted');
    getPosition.mockResolvedValue({
      coords: { latitude: 7, longitude: 6 },
    } as Location.LocationObject);
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    await waitFor(() => expect(animateToRegion).toHaveBeenCalled());
    expect(animateToRegion.mock.calls.at(-1)?.[0]).toMatchObject({ latitude: 7, longitude: 6 });
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeOnTheScreen();
  });

  it('services off: says to turn on Location Services', async () => {
    services.mockResolvedValue(false);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    expect(await screen.findByText(/Turn on Location Services in Settings/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
  });

  it('locate-me asks first when never asked, and a "no" explains instead of moving', async () => {
    await AsyncStorage.setItem('map.locationPromptDismissed', '1');
    requestPermission.mockImplementationOnce(async () => {
      permission('denied', false);
      return { status: 'denied', canAskAgain: false, granted: false } as never;
    });
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    expect(await screen.findByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    expect(animateToRegion).not.toHaveBeenCalled();
  });

  it('locate-me is a labelled button with a touch target of at least 44', async () => {
    await renderScreen();
    const button = screen.getByRole('button', { name: 'Locate me' });
    const flat = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
    expect(flat.width).toBeGreaterThanOrEqual(44);
    expect(flat.height).toBeGreaterThanOrEqual(44);
  });
});

describe('RestaurantMapScreen: re-renders', () => {
  it('moving the camera does not re-render the bottom sheet', async () => {
    await renderScreen();
    // Let the opening answers (pins, cuisines) arrive first: new data legitimately re-renders.
    await waitFor(() => expect(db.rpc).toHaveBeenCalled());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    const before = screen.getByTestId('bottom-sheet').props;
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        latitude: 40,
        longitude: 10,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      });
    });
    const after = screen.getByTestId('bottom-sheet').props;
    expect(after.onChange).toBe(before.onChange);
    expect(after.onClose).toBe(before.onClose);
  });
});

describe("RestaurantMapScreen: the person's position never leaves the phone", () => {
  it('sends only the map box to Supabase, never the position, and nothing else anywhere', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    permission('granted');
    const person = { latitude: 12.3456, longitude: 65.4321 };
    getPosition.mockResolvedValue({ coords: person } as Location.LocationObject);
    await renderScreen();
    await waitFor(() => expect(animateToRegion).toHaveBeenCalled());
    // The map settles on the person's neighbourhood.
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        ...person,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Locate me' }));
    await waitFor(() => expect(db.rpc.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });

    for (const [name, args] of db.rpc.mock.calls) {
      expect(name).toBe('map_restaurants_in_bounds');
      expect(Object.keys(args).sort()).toEqual([
        'p_max_lat',
        'p_max_lng',
        'p_min_lat',
        'p_min_lng',
      ]);
      expect(Object.values(args)).not.toContain(person.latitude);
      expect(Object.values(args)).not.toContain(person.longitude);
    }
    expect(JSON.stringify(db.rpc.mock.calls)).not.toMatch(/12\.3456|65\.4321/);
    expect(db.from).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The only thing stored is a region (four numbers) under the map keys.
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.every((key) => key.startsWith('map.'))).toBe(true);
    fetchSpy.mockRestore();
  });

  it('two positions in one grid cell send the same box, and the box is not centred on either', async () => {
    permission('granted');
    const first = { latitude: 12.3105, longitude: 65.3605 };
    const second = { latitude: 12.3205, longitude: 65.3705 };
    getPosition.mockResolvedValue({ coords: first } as Location.LocationObject);
    await renderScreen();
    // (The first request is the country fallback view; the position arrives just after.)
    const nearPerson = () =>
      db.rpc.mock.calls.filter(([, a]) => (a as { p_min_lat: number }).p_min_lat < 20);
    // The person's own area is asked for once the map has settled there.
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        ...first,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    });
    await waitFor(() => expect(nearPerson()).toHaveLength(1), { timeout: 2000 });

    // The person walks a little (same cell) and the map settles there.
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        ...second,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(nearPerson()).toHaveLength(1);
    const args = nearPerson()[0][1] as Record<string, number>;
    expect(args).toEqual({ p_min_lat: 12.3, p_max_lat: 12.35, p_min_lng: 65.35, p_max_lng: 65.4 });
    expect(Math.abs((args.p_min_lat + args.p_max_lat) / 2 - first.latitude)).toBeGreaterThan(0.009);
  });
});
