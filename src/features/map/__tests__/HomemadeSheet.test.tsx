import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { signedUrls } from '@/features/media/api';
import { getCurrencies } from '@/features/menu/api';

import { fetchHomemadeDetails, fetchHomemadeInBounds, MapAppError } from '../api';
import { HomemadeMapScreen } from '../components/HomemadeMapScreen';
import { SHEET_TITLE_MAX_FONT_MULTIPLIER } from '../components/RestaurantSheet';
import {
  HOMEMADE_AREA_NOTE,
  HOMEMADE_DISCLAIMER_BODY,
  HOMEMADE_DISCLAIMER_TITLE,
} from '../homemadeText';
import type { HomemadeDetails, Pin } from '../schema';

/* eslint-disable @typescript-eslint/no-require-imports */
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
  fetchHomemadeInBounds: jest.fn(),
  fetchHomemadeDetails: jest.fn(),
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const fetchDetails = jest.mocked(fetchHomemadeDetails);

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 1,
};
const rosa: Pin = { id: 'h1', name: "Nonna Rosa's Table", cuisine_code: 'IT', lat: 46.6, lng: 2.5 };

function details(overrides: Partial<HomemadeDetails> = {}): HomemadeDetails {
  return {
    id: 'h1',
    name: "Nonna Rosa's Table",
    cuisine_code: 'IT',
    currency_code: 'CAD',
    photos: [
      { id: 'p1', kind: 'cover', path: 'h1/cover.jpg', position: null, menu_item_id: null },
      { id: 'p2', kind: 'gallery', path: 'h1/g1.jpg', position: 1, menu_item_id: null },
    ],
    items: [
      {
        id: 'i1',
        name: 'Handmade tagliatelle',
        description: 'Slow ragù.',
        price_minor: 1800,
        is_available: true,
        position: 1,
      },
      {
        id: 'i2',
        name: 'Cannoli',
        description: null,
        price_minor: 900,
        is_available: false,
        position: 2,
      },
    ],
    ...overrides,
  };
}

async function openSheet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
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
  await fireEvent.press(await screen.findByRole('button', { name: /Nonna Rosa/ }));
  // Let the flag's short view-tracking timer and the photo URLs land inside act, so nothing
  // updates after the test ends.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  snapToIndex.mockClear();
  jest
    .mocked(fetchHomemadeInBounds)
    .mockResolvedValue({ pins: [rosa], capped: false, too_large: false });
  fetchDetails.mockReset();
  fetchDetails.mockResolvedValue(details());
  jest.mocked(listCuisines).mockResolvedValue([italy]);
  jest
    .mocked(getCurrencies)
    .mockResolvedValue([{ code: 'CAD', name: 'Canadian dollar', minor_units: 2 }] as Awaited<
      ReturnType<typeof getCurrencies>
    >);
  jest.mocked(signedUrls).mockResolvedValue({
    'h1/cover.jpg': 'https://x/cover',
    'h1/g1.jpg': 'https://x/g1',
  });
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
});

describe('the homemade sheet', () => {
  it('opens at the half snap and asks for the cook by id only', async () => {
    await openSheet();
    expect(snapToIndex).toHaveBeenCalledWith(1);
    await screen.findByTestId('homemade-disclaimer');
    expect(fetchDetails).toHaveBeenCalledWith('h1');
  });

  it('names the cook with the flag and cuisine', async () => {
    await openSheet();
    await screen.findByTestId('homemade-disclaimer');
    expect(screen.getByTestId('sheet-title')).toHaveTextContent("Nonna Rosa's Table");
    expect(screen.getByText('Italy')).toBeOnTheScreen();
    expect(screen.getByLabelText('Homemade cook details')).toBeOnTheScreen();
  });

  it('shows the small safety row, collapsed, with the note hidden until it is tapped', async () => {
    await openSheet();
    const row = await screen.findByTestId('homemade-disclaimer');
    expect(screen.getByText(HOMEMADE_DISCLAIMER_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(HOMEMADE_DISCLAIMER_BODY)).toBeNull();
    expect(row).toHaveProp('accessibilityState', { expanded: false });
    await fireEvent.press(row);
    expect(screen.getByText(HOMEMADE_DISCLAIMER_BODY)).toBeOnTheScreen();
  });

  it('never truncates the safety text, collapsed or open', async () => {
    await openSheet();
    await fireEvent.press(await screen.findByTestId('homemade-disclaimer'));
    expect(screen.getByText(HOMEMADE_DISCLAIMER_BODY).props.numberOfLines).toBeUndefined();
    expect(screen.getByText(HOMEMADE_DISCLAIMER_TITLE).props.numberOfLines).toBeUndefined();
  });

  it('says the area is approximate where a restaurant would show an address', async () => {
    await openSheet();
    expect(await screen.findByText(HOMEMADE_AREA_NOTE)).toBeOnTheScreen();
    expect(HOMEMADE_AREA_NOTE).toBe(
      'Approximate area only. The exact address is shared only if the cook accepts your request.',
    );
  });

  it('has no address, Directions, place ID, coordinates, Request or Report', async () => {
    await openSheet();
    await screen.findByText(HOMEMADE_AREA_NOTE);
    expect(screen.queryByText(/directions/i)).toBeNull();
    expect(screen.queryByLabelText(/directions/i)).toBeNull();
    expect(screen.queryByText(/^address/i)).toBeNull();
    expect(screen.queryByText(/FAKE_PLACE|place_id|place id/i)).toBeNull();
    expect(screen.queryByText(/request/i)).not.toBeNull(); // only inside the area note
    expect(screen.queryByRole('button', { name: /request|report|directions/i })).toBeNull();
    const everything = JSON.stringify(screen.toJSON());
    expect(everything).not.toMatch(/FAKE_PLACE|place_id|maps\.google|geo:/);
  });

  it("shows the menu with prices in the cook's own currency and written availability", async () => {
    await openSheet();
    expect(await screen.findByText('Handmade tagliatelle')).toBeOnTheScreen();
    expect(screen.getByText(/Available/)).toBeOnTheScreen();
    expect(screen.getByText(/Sold out/)).toBeOnTheScreen();
    expect(screen.getByText(/\$18\.00/)).toBeOnTheScreen();
  });

  it('shows only what exists: a cook with no photos and no items gets no photo strip error', async () => {
    fetchDetails.mockResolvedValue(details({ photos: [], items: [] }));
    await openSheet();
    await screen.findByTestId('homemade-disclaimer');
    expect(screen.getByText('No menu yet.')).toBeOnTheScreen();
  });

  it('says "This cook isn\'t available right now." for null, with a way out', async () => {
    fetchDetails.mockResolvedValue(null);
    await openSheet();
    expect(await screen.findByText("This cook isn't available right now.")).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it('shows an error with Retry, and Retry asks again', async () => {
    fetchDetails.mockRejectedValueOnce(new MapAppError('network'));
    fetchDetails.mockRejectedValueOnce(new MapAppError('network'));
    await openSheet();
    expect(
      await screen.findByText(
        'No connection. Check your internet and try again.',
        {},
        { timeout: 3000 },
      ),
    ).toBeOnTheScreen();
    fetchDetails.mockResolvedValue(details());
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('homemade-disclaimer')).toBeOnTheScreen();
  });

  it('shows "Try again in a moment" for a rate limit and does not retry on its own', async () => {
    fetchDetails.mockRejectedValue(new MapAppError('rate_limited'));
    await openSheet();
    expect(await screen.findByText('Try again in a moment')).toBeOnTheScreen();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen(),
    );
  });

  it('caps only the sheet title for large text (the safety row scales fully)', async () => {
    await openSheet();
    await fireEvent.press(await screen.findByTestId('homemade-disclaimer'));
    expect(SHEET_TITLE_MAX_FONT_MULTIPLIER).toBe(1.6);
    expect(screen.getByText(HOMEMADE_DISCLAIMER_BODY).props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByText(HOMEMADE_DISCLAIMER_TITLE).props.maxFontSizeMultiplier).toBeUndefined();
  });
});
