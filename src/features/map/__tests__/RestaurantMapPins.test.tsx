import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';

import { fetchPinsInBounds, MapAppError } from '../api';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { getCountryView } from '../countryViews';
import { roundBox, regionToBox } from '../region';
import type { Pin, PinsResponse } from '../schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __animateToRegion: animateToRegion } = require('react-native-maps') as {
  __animateToRegion: jest.Mock;
};

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  fetchPinsInBounds: jest.fn(),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const fetchPins = jest.mocked(fetchPinsInBounds);
const catalog: Cuisine[] = [
  { kind: 'country', code: 'IT', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 1 },
  { kind: 'country', code: 'FR', name: 'France', flag: '🇫🇷', icon: null, sort_order: 2 },
];

// All inside the France opening view (46.6, 2.5 ± 5 / 6.5).
function pin(id: string, name: string, cuisine = 'IT', lat = 46.6, lng = 2.5): Pin {
  return { id, name, cuisine_code: cuisine, lat, lng };
}
const joes = pin('p1', "Joe's Pizza", 'IT', 46.0, 2.0);
const chez = pin('p2', 'Chez Anne', 'FR', 48.0, 4.0);
function answer(pins: Pin[], extra: Partial<PinsResponse> = {}): PinsResponse {
  return { pins, capped: false, too_large: false, ...extra };
}

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never);

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

function moveMap(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}) {
  return act(async () => {
    screen.getByTestId('map-view').props.onRegionChangeComplete(region);
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // The location note is not what these tests are about.
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  animateToRegion.mockClear();
  fetchPins.mockReset();
  fetchPins.mockResolvedValue(answer([]));
  jest.mocked(listCuisines).mockResolvedValue(catalog);
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

describe('RestaurantMapScreen: pins', () => {
  it('draws each restaurant as a flag marker named after it and its cuisine', async () => {
    fetchPins.mockResolvedValue(answer([joes, chez]));
    await renderScreen();
    expect(
      await screen.findByRole('button', { name: "Joe's Pizza, Italy cuisine" }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Chez Anne, France cuisine' })).toBeOnTheScreen();
  });

  it('asks for the opening view only, as the rounded box', async () => {
    await renderScreen();
    await waitFor(() => expect(fetchPins).toHaveBeenCalledTimes(1));
    const view = getCountryView('FR');
    if (!view) throw new Error('no view');
    expect(fetchPins).toHaveBeenCalledWith(roundBox(regionToBox(view)));
  });

  it('waits for the person to stop moving, then sends one request for the last position', async () => {
    await renderScreen();
    await waitFor(() => expect(fetchPins).toHaveBeenCalledTimes(1));
    const base = { latitudeDelta: 1, longitudeDelta: 1 };
    await moveMap({ latitude: 45, longitude: 3, ...base });
    await moveMap({ latitude: 44, longitude: 4, ...base });
    expect(fetchPins).toHaveBeenCalledTimes(1); // still the opening request
    await waitFor(() => expect(fetchPins).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(fetchPins).toHaveBeenLastCalledWith(
      roundBox(regionToBox({ latitude: 44, longitude: 4, ...base })),
    );
  });

  it('shows a small "Loading restaurants" indicator while it loads, and then hides it', async () => {
    let resolve!: (value: PinsResponse) => void;
    fetchPins.mockReturnValue(new Promise((res) => (resolve = res)));
    await renderScreen();
    expect(
      await screen.findByRole('progressbar', { name: 'Loading restaurants' }),
    ).toBeOnTheScreen();
    await act(async () => resolve(answer([joes])));
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen());
  });

  it('keeps the old pins on screen while the next area loads', async () => {
    fetchPins.mockResolvedValueOnce(answer([joes]));
    await renderScreen();
    await screen.findByRole('button', { name: /Joe's Pizza/ });
    fetchPins.mockReturnValue(new Promise(() => undefined));
    await moveMap({ latitude: 46, longitude: 2, latitudeDelta: 4, longitudeDelta: 4 });
    await waitFor(() => expect(fetchPins).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(screen.getByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
  });

  describe('tapping', () => {
    it('selects a flag with a darker ring, without moving the map', async () => {
      fetchPins.mockResolvedValue(answer([joes, chez]));
      await renderScreen();
      const marker = await screen.findByRole('button', { name: /Joe's Pizza/ });
      const ringBefore = flat(screen.getAllByTestId('flag-pill')[0]).borderWidth;
      await fireEvent.press(marker);
      const pills = screen.getAllByTestId('flag-pill');
      const widths = pills.map((p) => flat(p).borderWidth as number);
      expect(Math.max(...widths)).toBeGreaterThan(ringBefore as number);
      // Exactly one flag is selected.
      expect(widths.filter((w) => w === Math.max(...widths))).toHaveLength(1);
      expect(animateToRegion).not.toHaveBeenCalled();
      expect(screen.getByTestId('map-view').props.moveOnMarkerPress).toBe(false);
    });

    it('clears the selection when the map itself is tapped', async () => {
      fetchPins.mockResolvedValue(answer([joes]));
      await renderScreen();
      await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
      const selected = flat(screen.getByTestId('flag-pill')).borderWidth as number;
      await act(async () => screen.getByTestId('map-view').props.onPress());
      expect(flat(screen.getByTestId('flag-pill')).borderWidth as number).toBeLessThan(selected);
    });

    it('zooms in to the pins of a tapped cluster', async () => {
      const close = [
        pin('a', 'A', 'IT', 46.0, 2.0),
        pin('b', 'B', 'IT', 46.0005, 2.0005),
        pin('c', 'C', 'IT', 46.001, 2.001),
      ];
      fetchPins.mockResolvedValue(answer(close));
      await renderScreen();
      const cluster = await screen.findByRole('button', {
        name: '3 places, double tap to zoom in',
      });
      await fireEvent.press(cluster);
      expect(animateToRegion).toHaveBeenCalledTimes(1);
      const [target] = animateToRegion.mock.calls[0];
      expect(target.latitude).toBeCloseTo(46.0005, 3);
      expect(target.longitude).toBeCloseTo(2.0005, 3);
      expect(target.latitudeDelta).toBeLessThan(0.1);
      // Individual flags are not drawn for a cluster.
      expect(screen.queryByRole('button', { name: /^A,/ })).not.toBeOnTheScreen();
    });
  });

  describe('notices', () => {
    it('says "No restaurants here yet" for an empty area, never while loading', async () => {
      let resolve!: (value: PinsResponse) => void;
      fetchPins.mockReturnValue(new Promise((res) => (resolve = res)));
      await renderScreen();
      await screen.findByRole('progressbar');
      expect(screen.queryByText('No restaurants here yet')).not.toBeOnTheScreen();
      await act(async () => resolve(answer([])));
      expect(await screen.findByText('No restaurants here yet')).toBeOnTheScreen();
      expect(screen.getByText(/Zoom out/)).toBeOnTheScreen();
    });

    it('hides "No restaurants here yet" as soon as the next area starts loading', async () => {
      await renderScreen();
      expect(await screen.findByText('No restaurants here yet')).toBeOnTheScreen();
      fetchPins.mockReturnValue(new Promise(() => undefined));
      await moveMap({ latitude: 46, longitude: 2, latitudeDelta: 4, longitudeDelta: 4 });
      await waitFor(() => expect(fetchPins).toHaveBeenCalledTimes(2), { timeout: 2000 });
      expect(screen.queryByText('No restaurants here yet')).not.toBeOnTheScreen();
      expect(screen.getByRole('progressbar', { name: 'Loading restaurants' })).toBeOnTheScreen();
    });

    it('shows "Zoom in to see more" when the answer is capped', async () => {
      fetchPins.mockResolvedValue(answer([joes], { capped: true }));
      await renderScreen();
      expect(await screen.findByText('Zoom in to see more')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
    });

    it('shows "Zoom in to see restaurants" when the server says too_large', async () => {
      fetchPins.mockResolvedValue(answer([], { too_large: true }));
      await renderScreen();
      expect(await screen.findByText('Zoom in to see restaurants')).toBeOnTheScreen();
      expect(screen.queryByText('No restaurants here yet')).not.toBeOnTheScreen();
      // Asked once; no loop.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
      expect(fetchPins).toHaveBeenCalledTimes(1);
    });

    it('does not ask the server, or draw pins, for a view that is too wide', async () => {
      jest
        .mocked(getLocales)
        .mockReturnValue([{ regionCode: null }] as unknown as ReturnType<typeof getLocales>);
      await renderScreen();
      expect(screen.getByText('Zoom in to see restaurants')).toBeOnTheScreen();
      await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
      expect(fetchPins).not.toHaveBeenCalled();
      expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('marker')).not.toBeOnTheScreen();
    });

    it('hides the pins when the person zooms out past the limit', async () => {
      fetchPins.mockResolvedValue(answer([joes]));
      await renderScreen();
      await screen.findByRole('button', { name: /Joe's Pizza/ });
      await moveMap({ latitude: 0, longitude: 0, latitudeDelta: 100, longitudeDelta: 100 });
      expect(screen.getByText('Zoom in to see restaurants')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: /Joe's Pizza/ })).not.toBeOnTheScreen();
    });
  });

  describe('errors', () => {
    it('shows a banner with Retry, keeps the old pins, and retry loads again', async () => {
      fetchPins.mockResolvedValueOnce(answer([joes]));
      await renderScreen();
      await screen.findByRole('button', { name: /Joe's Pizza/ });
      fetchPins.mockRejectedValue(new MapAppError('unknown'));
      await moveMap({ latitude: 46, longitude: 2, latitudeDelta: 4, longitudeDelta: 4 });
      expect(
        await screen.findByText("We couldn't load restaurants. Try again.", undefined, {
          timeout: 4000,
        }),
      ).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
      expect(screen.queryByText('No restaurants here yet')).not.toBeOnTheScreen();

      fetchPins.mockReset();
      fetchPins.mockResolvedValue(answer([joes, chez]));
      await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('button', { name: /Chez Anne/ })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen();
    });

    it('treats rate_limited as a calm note: old pins stay, no error styling, no automatic retry', async () => {
      fetchPins.mockResolvedValueOnce(answer([joes]));
      await renderScreen();
      await screen.findByRole('button', { name: /Joe's Pizza/ });
      fetchPins.mockRejectedValue(new MapAppError('rate_limited'));
      await moveMap({ latitude: 46, longitude: 2, latitudeDelta: 4, longitudeDelta: 4 });
      expect(
        await screen.findByText('Try again in a moment', undefined, { timeout: 4000 }),
      ).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: /Joe's Pizza/ })).toBeOnTheScreen();
      // Not the error banner: no alert role, no warning sign, no Retry button.
      expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
      expect(screen.queryByText('⚠')).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen();
      // Nothing is re-sent on its own.
      const calls = fetchPins.mock.calls.length;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 1300)));
      expect(fetchPins).toHaveBeenCalledTimes(calls);

      fetchPins.mockReset();
      fetchPins.mockResolvedValue(answer([joes]));
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(fetchPins).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.queryByText('Try again in a moment')).not.toBeOnTheScreen(),
      );
    });

    it('sends a new request when the map moves after a rate limit', async () => {
      fetchPins.mockRejectedValueOnce(new MapAppError('rate_limited'));
      await renderScreen();
      expect(await screen.findByText('Try again in a moment')).toBeOnTheScreen();
      fetchPins.mockResolvedValue(answer([chez]));
      await moveMap({ latitude: 47, longitude: 3, latitudeDelta: 4, longitudeDelta: 4 });
      expect(
        await screen.findByRole('button', { name: /Chez Anne/ }, { timeout: 2000 }),
      ).toBeOnTheScreen();
      expect(screen.queryByText('Try again in a moment')).not.toBeOnTheScreen();
    });
  });
});
