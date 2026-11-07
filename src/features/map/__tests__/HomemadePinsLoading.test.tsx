import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { getCurrencies } from '@/features/menu/api';
import { signedUrls } from '@/features/media/api';

import { fetchHomemadeDetails, fetchHomemadeInBounds, fetchPinsInBounds } from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { regionToBox, snapBox } from '../region';
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

// A different box that still shows the cook, so a failed answer for it can be seen to keep the flag.
const NEARBY = { latitude: 46.5, longitude: 2.6, latitudeDelta: 1, longitudeDelta: 1 };

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  testClients.push(queryClient);
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

// The spec 07 pins behaviour, proven against the HOMEMADE call (map_homemade_in_bounds): the
// request waits for the person to stop moving (400 ms), a late answer for an area the person has
// left is dropped, and the old flags stay on screen while the next area loads.
const chez: Pin = { id: 'h2', name: 'Chez Anne', cuisine_code: 'IT', lat: 48, lng: 4 };
const ghost: Pin = { id: 'h9', name: 'Ghost Kitchen', cuisine_code: 'IT', lat: 48, lng: 4 };
const AREA_ONE = { latitude: 46, longitude: 2, latitudeDelta: 1, longitudeDelta: 1 };
const AREA_TWO = { latitude: 48, longitude: 4, latitudeDelta: 1, longitudeDelta: 1 };

describe('Homemade pins: debounce, late answers, old pins', () => {
  it('waits 400 ms after the person stops moving, then sends one request for the last position', async () => {
    await renderScreen();
    await waitFor(() => expect(fetchCooks).toHaveBeenCalledTimes(1)); // the opening view
    await moveMap({ latitude: 45, longitude: 3, latitudeDelta: 1, longitudeDelta: 1 });
    await moveMap({ latitude: 44, longitude: 4, latitudeDelta: 1, longitudeDelta: 1 });
    // Immediately after the moves: still only the opening request.
    expect(fetchCooks).toHaveBeenCalledTimes(1);
    // Not yet at 300 ms either.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(fetchCooks).toHaveBeenCalledTimes(1);
    // Once the pause has passed: exactly one more request, for the last position only.
    await waitFor(() => expect(fetchCooks).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(fetchCooks).toHaveBeenLastCalledWith(
      snapBox(regionToBox({ latitude: 44, longitude: 4, latitudeDelta: 1, longitudeDelta: 1 })),
    );
    expect(fetchRestaurants).not.toHaveBeenCalled();
  });

  it('keeps the old flags on screen while the next area loads', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Nonna Rosa/ });
    fetchCooks.mockReturnValueOnce(new Promise<PinsResponse>(() => undefined));
    await moveMap(NEARBY);
    await waitFor(() => expect(fetchCooks).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(screen.getByRole('button', { name: /Nonna Rosa/ })).toBeOnTheScreen();
  });

  it('ignores a late answer for an area the person has already left', async () => {
    let answerFirstArea: (value: PinsResponse) => void = () => undefined;
    fetchCooks.mockResolvedValueOnce(answer([]));
    await renderScreen();
    await waitFor(() => expect(fetchCooks).toHaveBeenCalledTimes(1));

    // Pan to area one: its answer is slow.
    fetchCooks.mockReturnValueOnce(
      new Promise<PinsResponse>((resolve) => {
        answerFirstArea = resolve;
      }),
    );
    await moveMap(AREA_ONE);
    await waitFor(() => expect(fetchCooks).toHaveBeenCalledTimes(2), { timeout: 2000 });

    // Pan on to area two before it arrives: answered at once.
    fetchCooks.mockResolvedValueOnce(answer([chez]));
    await moveMap(AREA_TWO);
    expect(
      await screen.findByRole('button', { name: /Chez Anne/ }, { timeout: 2000 }),
    ).toBeOnTheScreen();

    // Now the old area's answer arrives, with a cook who also sits in area two's view.
    await act(async () => answerFirstArea(answer([ghost])));
    expect(screen.getByRole('button', { name: /Chez Anne/ })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Ghost Kitchen/ })).not.toBeOnTheScreen();
  });
});
