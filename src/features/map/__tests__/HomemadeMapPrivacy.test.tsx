import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { getLocales } from 'expo-localization';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { supabase } from '@/lib/supabase';

import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { regionToBox, snapBox } from '../region';

/* eslint-disable @typescript-eslint/no-require-imports */
const { __animateToRegion: animateToRegion } = require('react-native-maps') as {
  __animateToRegion: jest.Mock;
};
/* eslint-enable @typescript-eslint/no-require-imports */

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const db = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };
const getPosition = jest.mocked(Location.getCurrentPositionAsync);

function granted() {
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue({ status: 'granted', canAskAgain: true, granted: true } as never);
}

async function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  testClients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <HomemadeMapScreen />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('map-view');
}

function settleOn(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}) {
  return act(async () => {
    screen.getByTestId('map-view').props.onRegionChangeComplete(region);
  });
}

const near = (calls: unknown[][], maxLat: number) =>
  calls.filter(([, args]) => (args as { p_min_lat: number }).p_min_lat < maxLat);

// useSignedUrls keeps its URLs for 55 minutes after unmount; unmount first, then clear every client
// so no gc timer outlives the test and keeps the jest worker alive.
const testClients: QueryClient[] = [];
afterEach(async () => {
  await cleanup();
  testClients.splice(0).forEach((client) => client.clear());
});

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  animateToRegion.mockClear();
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: { pins: [], capped: false, too_large: false }, error: null });
  db.from.mockReset();
  jest.mocked(listCuisines).mockResolvedValue([]);
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

describe("Homemade: the person's position never leaves the phone", () => {
  it('sends only the map box to map_homemade_in_bounds, never the position', async () => {
    granted();
    const person = { latitude: 12.3456, longitude: 65.4321 };
    getPosition.mockResolvedValue({ coords: person } as Location.LocationObject);
    await renderScreen();
    await waitFor(() => expect(animateToRegion).toHaveBeenCalled());
    await settleOn({ ...person, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    await waitFor(() => expect(db.rpc.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });

    for (const [name, args] of db.rpc.mock.calls) {
      expect(name).toBe('map_homemade_in_bounds');
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
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.every((key) => key.startsWith('map.'))).toBe(true);
  });

  it('two positions in one grid cell send the same box, and the box is not centred on either', async () => {
    granted();
    const first = { latitude: 12.3105, longitude: 65.3605 };
    const second = { latitude: 12.3205, longitude: 65.3705 };
    getPosition.mockResolvedValue({ coords: first } as Location.LocationObject);
    await renderScreen();
    await settleOn({ ...first, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    await waitFor(() => expect(near(db.rpc.mock.calls, 20)).toHaveLength(1), { timeout: 2000 });
    await settleOn({ ...second, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(near(db.rpc.mock.calls, 20)).toHaveLength(1);
    const args = near(db.rpc.mock.calls, 20)[0][1] as Record<string, number>;
    expect(args).toEqual({ p_min_lat: 12.3, p_max_lat: 12.35, p_min_lng: 65.35, p_max_lng: 65.4 });
    expect(Math.abs((args.p_min_lat + args.p_max_lat) / 2 - first.latitude)).toBeGreaterThan(0.009);
  });

  it.each([
    [
      'an ordinary view',
      { latitude: 10.003, longitude: 20.007, latitudeDelta: 0.04, longitudeDelta: 0.04 },
    ],
    [
      'the date line (east)',
      { latitude: 10.003, longitude: 179.995, latitudeDelta: 0.04, longitudeDelta: 0.04 },
    ],
    [
      'the date line (west)',
      { latitude: -4.5, longitude: -179.992, latitudeDelta: 0.06, longitudeDelta: 0.06 },
    ],
  ])('the sent box contains the visible box: %s', async (_label, view) => {
    await renderScreen();
    await settleOn(view);
    const visible = regionToBox(view);
    await waitFor(
      () =>
        expect(
          db.rpc.mock.calls.some(
            ([, a]) =>
              (a as { p_min_lat: number }).p_min_lat < 11 &&
              Math.abs((a as { p_min_lat: number }).p_min_lat - snapBox(visible).minLat) < 1e-9,
          ),
        ).toBe(true),
      { timeout: 2000 },
    );
    const sent = db.rpc.mock.calls
      .map(
        ([, a]) =>
          a as { p_min_lat: number; p_max_lat: number; p_min_lng: number; p_max_lng: number },
      )
      .find((a) => Math.abs(a.p_min_lat - snapBox(visible).minLat) < 1e-9);
    expect(sent).toBeDefined();
    expect(sent!.p_min_lat).toBeLessThanOrEqual(visible.minLat);
    expect(sent!.p_max_lat).toBeGreaterThanOrEqual(visible.maxLat);
    expect(sent!.p_min_lng).toBeLessThanOrEqual(visible.minLng);
    expect(sent!.p_max_lng).toBeGreaterThanOrEqual(visible.maxLng);
  });
});
