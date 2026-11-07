import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { getCurrencies } from '@/features/menu/api';

import { fetchPinsInBounds, fetchRestaurantDetails } from '../api';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { isMarkerPressEvent } from '../mapEvents';
import type { Pin } from '../schema';

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
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  fetchPinsInBounds: jest.fn(),
  fetchRestaurantDetails: jest.fn(),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 1,
};
const joes: Pin = { id: 'b1', name: "Joe's Pizza", cuisine_code: 'IT', lat: 46.0, lng: 2.0 };
// Three pins on one spot: they cluster at the opening zoom.
const stack: Pin[] = ['a', 'b', 'c'].map((id, i) => ({
  id,
  name: `Stack ${id}`,
  cuisine_code: 'IT',
  lat: 47 + i * 0.0001,
  lng: 3 + i * 0.0001,
}));

async function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
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
  await screen.findByTestId('map-view');
}

const ring = () => StyleSheet.flatten(screen.getByTestId('flag-pill').props.style).borderWidth;

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  animateToRegion.mockClear();
  snapToIndex.mockClear();
  ignoreStopPropagation(false);
  jest.mocked(fetchPinsInBounds).mockReset();
  jest
    .mocked(fetchPinsInBounds)
    .mockResolvedValue({ pins: [joes], capped: false, too_large: false });
  jest.mocked(fetchRestaurantDetails).mockReset();
  jest.mocked(fetchRestaurantDetails).mockResolvedValue(null);
  jest.mocked(listCuisines).mockResolvedValue([italy]);
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

describe('isMarkerPressEvent', () => {
  it('recognises the map press that a marker press leaves behind', () => {
    expect(isMarkerPressEvent({ nativeEvent: { action: 'marker-press', id: 'x' } })).toBe(true);
  });

  it.each([
    ['a press on the bare map', { nativeEvent: { action: 'press' } }],
    ['a long press', { nativeEvent: { action: 'long-press' } }],
    ['no action', { nativeEvent: {} }],
    ['no native event', {}],
    ['a null native event', { nativeEvent: null }],
    ['a string', 'marker-press'],
    ['null', null],
    ['undefined', undefined],
  ])('does not treat %s as a marker press', (_label, event) => {
    expect(isMarkerPressEvent(event)).toBe(false);
  });
});

describe('a marker press must not be undone by the map press', () => {
  it('asks the library to stop the press at the marker (flags and clusters)', async () => {
    jest
      .mocked(fetchPinsInBounds)
      .mockResolvedValue({ pins: [joes, ...stack], capped: false, too_large: false });
    await renderScreen();
    const flag = await screen.findByRole('button', { name: /Joe's Pizza/ });
    expect(flag.props.stopPropagation).toBe(true);
    const cluster = await screen.findByRole('button', { name: /places, double tap to zoom in/ });
    expect(cluster.props.stopPropagation).toBe(true);
  });

  it('keeps the sheet open after a flag tap, although the press bubbles towards the map', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
    expect(ring()).toBeGreaterThan(StyleSheet.hairlineWidth);
    expect(animateToRegion).not.toHaveBeenCalled();
  });

  it('still keeps it open on a platform that ignores stopPropagation (the map ignores bubbled marker presses)', async () => {
    ignoreStopPropagation(true);
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
    expect(ring()).toBeGreaterThan(StyleSheet.hairlineWidth);
  });

  it('still closes it when the bare map is tapped', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
    await act(async () =>
      screen.getByTestId('map-view').props.onPress({ nativeEvent: { action: 'press' } }),
    );
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
    expect(ring()).toBeLessThanOrEqual(StyleSheet.hairlineWidth);
  });

  it('a cluster tap zooms in and does not close an open sheet by bubbling', async () => {
    jest
      .mocked(fetchPinsInBounds)
      .mockResolvedValue({ pins: [joes, ...stack], capped: false, too_large: false });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
    await fireEvent.press(
      await screen.findByRole('button', { name: /places, double tap to zoom in/ }),
    );
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sheet-title')).toBeOnTheScreen();
  });
});
