import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { getLocales } from 'expo-localization';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { getCurrencies } from '@/features/menu/api';
import { signedUrls } from '@/features/media/api';
import { offersKeyRoot } from '@/features/promotions/hooks/useOffers';
import { OFFER_ENDED_TEXT } from '@/features/promotions/messages';

import {
  fetchHomemadeDetails,
  fetchHomemadeInBounds,
  fetchPinsInBounds,
  fetchRestaurantDetails,
} from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { homemadeDetailsKey } from '../hooks/useHomemadeDetails';
import { detailsKey } from '../hooks/useRestaurantDetails';
import type { OfferTarget } from '../offerTarget';
import { NEIGHBOURHOOD_DELTA, regionForPick } from '../region';
import type { HomemadeDetails, Pin, RestaurantDetails } from '../schema';

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

// Spec 16 Decision D15: an Offers card opens its place on its map tab.

const vietnam: Cuisine = {
  kind: 'country',
  code: 'VN',
  name: 'Vietnam',
  flag: String.fromCodePoint(0x1f1fb, 0x1f1f3),
  icon: null,
  sort_order: 1,
};

const ID = '00000000-0000-4000-8000-000000001701';
const TARGET: OfferTarget = { business: ID, lat: 43.90137, lng: -78.86229 };
const PIN: Pin = {
  id: ID,
  name: 'Simcoe Street Pho',
  cuisine_code: 'VN',
  lat: TARGET.lat,
  lng: TARGET.lng,
  promoted: true,
};

const restaurant = (sponsored: boolean): RestaurantDetails => ({
  id: ID,
  name: PIN.name,
  cuisine_code: 'VN',
  accepts_table_requests: false,
  public_address: '12 Simcoe St N, Oshawa',
  place_id: 'place-1',
  currency_code: null,
  sponsored,
  photos: [],
  items: [],
});
const homemade = (sponsored: boolean): HomemadeDetails => ({
  id: ID,
  name: PIN.name,
  cuisine_code: 'VN',
  currency_code: null,
  sponsored,
  photos: [],
  items: [],
});

type Tab = 'restaurants' | 'homemade';
const TABS: Tab[] = ['restaurants', 'homemade'];

let client: QueryClient;
let onHandled: jest.Mock;

function tree(tab: Tab, target: OfferTarget | null) {
  const Screen = tab === 'restaurants' ? RestaurantMapScreen : HomemadeMapScreen;
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <Screen offerTarget={target} onOfferTargetHandled={onHandled} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

async function renderTab(tab: Tab, target: OfferTarget | null = TARGET) {
  const view = await render(tree(tab, target));
  await screen.findByTestId('map-view');
  return view;
}

function setDetails(tab: Tab, answer: 'sponsored' | 'ended' | 'gone' | 'error') {
  if (tab === 'restaurants') {
    jest.mocked(fetchRestaurantDetails).mockImplementation(async () => {
      if (answer === 'error') throw new Error('offline');
      return answer === 'gone' ? null : restaurant(answer === 'sponsored');
    });
  } else {
    jest.mocked(fetchHomemadeDetails).mockImplementation(async () => {
      if (answer === 'error') throw new Error('offline');
      return answer === 'gone' ? null : homemade(answer === 'sponsored');
    });
  }
}

function setPins(tab: Tab, pins: Pin[]) {
  const answer = { pins, capped: false, too_large: false };
  if (tab === 'restaurants') jest.mocked(fetchPinsInBounds).mockResolvedValue(answer);
  else jest.mocked(fetchHomemadeInBounds).mockResolvedValue(answer);
}

const detailsFetcher = (tab: Tab) =>
  tab === 'restaurants' ? jest.mocked(fetchRestaurantDetails) : jest.mocked(fetchHomemadeDetails);
const sponsoredInSheet = () =>
  screen.queryByTestId('sponsored-label', { includeHiddenElements: true });
const sheetTitle = () => screen.queryByTestId('sheet-title');
/** The sheet is open on the offer's place. */
const findSheet = async () => {
  const title = await screen.findByTestId('sheet-title');
  expect(title).toHaveTextContent(PIN.name);
  return title;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  client = new QueryClient(testClientOptions());
  onHandled = jest.fn();
  // Clears every call count (the details fetchers' too) and keeps the implementations set below.
  jest.clearAllMocks();
  jest.mocked(listCuisines).mockResolvedValue([vietnam]);
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest.mocked(signedUrls).mockResolvedValue({});
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'CA' }] as unknown as ReturnType<typeof getLocales>);
  for (const tab of TABS) {
    setPins(tab, [PIN]);
    setDetails(tab, 'sponsored');
  }
});

afterEach(async () => {
  await cleanup();
  client.clear();
  resetModuleMocks(
    '@/features/cuisines/api',
    '@/features/menu/api',
    '@/features/media/api',
    '@/features/map/api',
  );
});

describe.each(TABS)('card to map on the %s tab', (tab) => {
  it('moves the camera to the place, above the half-open sheet, at neighbourhood zoom', async () => {
    await renderTab(tab);
    await waitFor(() => expect(animateToRegion).toHaveBeenCalledTimes(1));
    const [region] = animateToRegion.mock.calls[0];
    expect(region).toEqual(regionForPick({ lat: TARGET.lat, lng: TARGET.lng }, null));
    expect(region.latitudeDelta).toBe(NEIGHBOURHOOD_DELTA);
    expect(region.longitude).toBe(TARGET.lng);
  });

  it('opens the sheet with "Sponsored" for a running campaign, and clears the params', async () => {
    await renderTab(tab);
    await waitFor(() => expect(sponsoredInSheet()).not.toBeNull());
    await findSheet();
    expect(screen.queryByText(OFFER_ENDED_TEXT)).toBeNull();
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it("opens the sheet even when that area's pins have not loaded yet", async () => {
    setPins(tab, []);
    await renderTab(tab);
    await findSheet();
    await waitFor(() => expect(sponsoredInSheet()).not.toBeNull());
  });

  it('shows the friendly message and no sheet when the place is not available', async () => {
    setDetails(tab, 'gone');
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await renderTab(tab);
    expect(await screen.findByText(OFFER_ENDED_TEXT)).toBeOnTheScreen();
    expect(sheetTitle()).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: offersKeyRoot });
  });

  it('opens the sheet with the friendly message, and no "Sponsored", when the campaign has ended', async () => {
    setDetails(tab, 'ended');
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await renderTab(tab);
    expect(await screen.findByText(OFFER_ENDED_TEXT)).toBeOnTheScreen();
    await findSheet();
    expect(sponsoredInSheet()).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: offersKeyRoot });
  });

  it('reads the details fresh: a cached "sponsored" answer is not trusted', async () => {
    const key = tab === 'restaurants' ? detailsKey(ID) : homemadeDetailsKey(ID);
    client.setQueryData(key, tab === 'restaurants' ? restaurant(true) : homemade(true));
    setDetails(tab, 'ended');
    await renderTab(tab);
    expect(await screen.findByText(OFFER_ENDED_TEXT)).toBeOnTheScreen();
    expect(detailsFetcher(tab)).toHaveBeenCalledWith(ID);
  });

  it('opens a loaded pin when the details read fails (the sheet shows its own error)', async () => {
    setDetails(tab, 'error');
    await renderTab(tab);
    await findSheet();
    expect(screen.queryByText(OFFER_ENDED_TEXT)).toBeNull();
  });

  it('closes the message with Close', async () => {
    setDetails(tab, 'gone');
    await renderTab(tab);
    await screen.findByText(OFFER_ENDED_TEXT);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(OFFER_ENDED_TEXT)).toBeNull();
  });

  it('handles a target once, and the same card again after the params were cleared', async () => {
    const view = await renderTab(tab);
    await waitFor(() => expect(animateToRegion).toHaveBeenCalledTimes(1));
    await view.rerender(tree(tab, { ...TARGET }));
    await act(async () => {});
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    expect(detailsFetcher(tab)).toHaveBeenCalledTimes(1);

    await view.rerender(tree(tab, null));
    await view.rerender(tree(tab, { ...TARGET }));
    await waitFor(() => expect(animateToRegion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(detailsFetcher(tab)).toHaveBeenCalledTimes(2));
    expect(onHandled).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a target', async () => {
    await renderTab(tab, null);
    await act(async () => {});
    expect(animateToRegion).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();
    expect(detailsFetcher(tab)).not.toHaveBeenCalled();
  });
});

describe('a late position fix', () => {
  it("does not pull the camera away from the offer's place", async () => {
    let fix: (value: unknown) => void = () => {};
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
      granted: true,
    } as unknown as Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>>);
    jest.mocked(Location.getCurrentPositionAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          fix = resolve;
        }) as unknown as ReturnType<typeof Location.getCurrentPositionAsync>,
    );
    await renderTab('restaurants');
    await waitFor(() => expect(animateToRegion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(Location.getCurrentPositionAsync).toHaveBeenCalled());
    await act(async () => fix({ coords: { latitude: 45.5, longitude: -73.6 } }));
    await act(async () => {});
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    expect(animateToRegion.mock.calls[0][0].longitude).toBe(TARGET.lng);
  });
});
