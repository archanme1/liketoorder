import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import * as Location from 'expo-location';
import { Linking } from 'react-native';

import { listCuisines } from '@/features/cuisines/api';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { HOMEMADE_REGION_KEY, REGION_KEY } from '@/features/map/lastRegion';
import { signedUrls } from '@/features/media/api';
import { supabase } from '@/lib/supabase';

import { createOffersServer, makeOffer, type OffersServer } from '../__fixtures__/offers';
import { offersScreenTree, setLocation, VIETNAM } from '../__fixtures__/offersScreen';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  signedUrls: jest.fn(),
}));

// Spec 16 Offers: how "near me" is decided (Decision D2, Resolved Q14).

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
let client: QueryClient;
let server: OffersServer;

// A Toronto view (snaps to 43.65, -79.4) and a Cambridge one (43.35, -80.3): both differ from
// Oshawa's grid point (43.9, -78.85), so each call shows which area was used.
const TORONTO = {
  latitude: 43.6532,
  longitude: -79.3832,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
const CAMBRIDGE = {
  latitude: 43.3616,
  longitude: -80.3144,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
const COUNTRY = { latitude: 47, longitude: -85, latitudeDelta: 24, longitudeDelta: 40 };

const OFF = /Location is off/;
const lastCall = () => server.calls[server.calls.length - 1];
const at = (lat: number, lng: number) =>
  expect(lastCall()).toMatchObject({ p_lat: lat, p_lng: lng });

async function renderScreen() {
  await render(offersScreenTree(client));
  await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
}

async function openChangeArea() {
  await fireEvent.press(screen.getByRole('button', { name: 'Change area' }));
  return within(await screen.findByTestId('change-area'));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient(testClientOptions());
  server = createOffersServer({ rows: [makeOffer()] });
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  jest.mocked(listCuisines).mockResolvedValue([VIETNAM]);
  jest.mocked(signedUrls).mockResolvedValue({});
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('@/lib/supabase', '@/features/cuisines/api', '@/features/media/api');
});

describe('location allowed', () => {
  it('lists near the person, from the snapped point, with no note', async () => {
    setLocation('granted');
    await renderScreen();
    at(43.9, -78.85);
    expect(await screen.findByText('Near you')).toBeOnTheScreen();
    expect(screen.queryByText(/Showing offers near/)).toBeNull();
    expect(screen.queryByText('Show offers near you?')).toBeNull();
  });

  it('falls back to the area when no position comes, and says why', async () => {
    setLocation('granted', { fix: null });
    await renderScreen();
    expect(
      await screen.findByText("We couldn't find your location. Showing offers near Oshawa."),
    ).toBeOnTheScreen();
    expect(screen.getByText('Near Oshawa')).toBeOnTheScreen();
    expect(screen.queryByText(OFF)).toBeNull();
  });
});

describe('never asked', () => {
  beforeEach(() => setLocation('undetermined'));

  it('shows the note about a rough area, while the list already shows the fallback area', async () => {
    await AsyncStorage.setItem(REGION_KEY, JSON.stringify(TORONTO));
    await renderScreen();
    expect(await screen.findByText('Show offers near you?')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'LikeToOrder can use your location to show offers near you. Your exact location stays on your phone. We only receive a rough area. You can say no.',
      ),
    ).toBeOnTheScreen();
    at(43.65, -79.4);
    expect(screen.queryByText(OFF)).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('"Use my location" asks the system, then lists near the person', async () => {
    await AsyncStorage.setItem(REGION_KEY, JSON.stringify(TORONTO));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Use my location' }));
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Near you')).toBeOnTheScreen();
    await waitFor(() => at(43.9, -78.85));
  });

  it('"Not now" hides the note and says "Showing offers near", never "Location is off"', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('Showing offers near Oshawa.')).toBeOnTheScreen();
    expect(screen.queryByText(OFF)).toBeNull();
    expect(screen.queryByText('Show offers near you?')).toBeNull();
  });

  it('after "Not now" (even on a map), Change area > Use my location still opens the system prompt', async () => {
    await AsyncStorage.setItem('map.locationPromptDismissed', '1');
    await renderScreen();
    expect(await screen.findByText('Showing offers near Oshawa.')).toBeOnTheScreen();
    expect(screen.queryByText('Show offers near you?')).toBeNull();
    const sheet = await openChangeArea();
    await fireEvent.press(sheet.getByRole('radio', { name: 'Use my location' }));
    await waitFor(() =>
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText('Near you')).toBeOnTheScreen();
  });
});

describe('location off', () => {
  it('denied: "Location is off", the area, and Change area to try again', async () => {
    setLocation('denied', { grantOnRequest: false });
    await renderScreen();
    expect(
      await screen.findByText('Location is off. Showing offers near Oshawa.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    // The system can still ask: Use my location asks it.
    const sheet = await openChangeArea();
    await fireEvent.press(sheet.getByRole('radio', { name: 'Use my location' }));
    await waitFor(() =>
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText('Location is off. Showing offers near Oshawa.'),
    ).toBeOnTheScreen();
  });

  it('denied for good: Open Settings', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    setLocation('denied_forever');
    await renderScreen();
    expect(
      await screen.findByText('Location is off. Showing offers near Oshawa.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('Location Services off: Open Settings', async () => {
    setLocation('services_off');
    await renderScreen();
    expect(
      await screen.findByText('Location is off. Showing offers near Oshawa.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
  });
});

describe('the fallback area', () => {
  beforeEach(() => setLocation('denied_forever'));

  it('uses the last Restaurants map view first', async () => {
    await AsyncStorage.setItem(REGION_KEY, JSON.stringify(TORONTO));
    await AsyncStorage.setItem(HOMEMADE_REGION_KEY, JSON.stringify(CAMBRIDGE));
    await renderScreen();
    at(43.65, -79.4);
    expect(
      await screen.findByText(
        'Location is off. Showing offers near the area you last viewed on the map.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Near the area you last viewed on the map')).toBeOnTheScreen();
  });

  it('then the last Homemade view', async () => {
    await AsyncStorage.setItem(HOMEMADE_REGION_KEY, JSON.stringify(CAMBRIDGE));
    await renderScreen();
    at(43.35, -80.3);
  });

  it('skips a country-wide view and uses the launch area', async () => {
    await AsyncStorage.setItem(REGION_KEY, JSON.stringify(COUNTRY));
    await renderScreen();
    at(43.9, -78.85);
    expect(await screen.findByText('Near Oshawa')).toBeOnTheScreen();
  });

  it('only reads the saved views, never writes them', async () => {
    await AsyncStorage.setItem(REGION_KEY, JSON.stringify(TORONTO));
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    // The storage mock already counted the test's own setup writes.
    setItem.mockClear();
    await renderScreen();
    await screen.findByText('Near the area you last viewed on the map');
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('Change area', () => {
  it('switches between my location, the last map view and the launch area', async () => {
    setLocation('granted');
    await AsyncStorage.setItem(REGION_KEY, JSON.stringify(TORONTO));
    await renderScreen();
    expect(await screen.findByText('Near you')).toBeOnTheScreen();

    let sheet = await openChangeArea();
    expect(sheet.getByRole('radio', { name: 'Use my location, selected' })).toBeOnTheScreen();
    await fireEvent.press(sheet.getByRole('radio', { name: 'Oshawa (launch area)' }));
    expect(await screen.findByText('Near Oshawa')).toBeOnTheScreen();
    // Picked on purpose: no note about location.
    expect(screen.queryByText(/Showing offers near/)).toBeNull();
    expect(screen.queryByTestId('change-area')).toBeNull();

    sheet = await openChangeArea();
    await fireEvent.press(sheet.getByRole('radio', { name: 'Area last viewed on the map' }));
    expect(await screen.findByText('Near the area you last viewed on the map')).toBeOnTheScreen();
    await waitFor(() => at(43.65, -79.4));

    sheet = await openChangeArea();
    await fireEvent.press(sheet.getByRole('radio', { name: 'Use my location' }));
    expect(await screen.findByText('Near you')).toBeOnTheScreen();
    await waitFor(() => at(43.9, -78.85));
  });

  it('offers the last map view only when there is one, and closes with Cancel or Close', async () => {
    setLocation('granted');
    await renderScreen();
    await screen.findByText('Near you');
    let sheet = await openChangeArea();
    expect(sheet.queryByRole('radio', { name: /Area last viewed/ })).toBeNull();
    await fireEvent.press(sheet.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('change-area')).toBeNull();
    sheet = await openChangeArea();
    await fireEvent.press(sheet.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('change-area')).toBeNull();
    await act(async () => {});
    expect(screen.getByText('Near you')).toBeOnTheScreen();
  });
});
