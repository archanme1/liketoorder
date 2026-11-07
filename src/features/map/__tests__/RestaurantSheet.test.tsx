import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { AccessibilityInfo, Linking, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import type { Cuisine } from '@/features/cuisines/schema';
import { signedUrls } from '@/features/media/api';
import { getCurrencies } from '@/features/menu/api';

import { fetchPinsInBounds, fetchRestaurantDetails, MapAppError } from '../api';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { collapsedSnap, SHEET_TITLE_MAX_FONT_MULTIPLIER } from '../components/RestaurantSheet';
import { buildDirectionsUrl } from '../directions';
import type { Pin, PinsResponse, RestaurantDetails } from '../schema';

/* eslint-disable @typescript-eslint/no-require-imports */
const { __animateToRegion: animateToRegion } = require('react-native-maps') as {
  __animateToRegion: jest.Mock;
};
const { __snapToIndex: snapToIndex, __close: closeSheet } = require('@gorhom/bottom-sheet') as {
  __snapToIndex: jest.Mock;
  __close: jest.Mock;
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
}));
jest.mock('../mapConfig', () => ({
  ...jest.requireActual('../mapConfig'),
  useMapConfigured: jest.fn(() => true),
}));

const fetchPins = jest.mocked(fetchPinsInBounds);
const fetchDetails = jest.mocked(fetchRestaurantDetails);
const mockedSignedUrls = jest.mocked(signedUrls);

const catalog: Cuisine[] = [
  { kind: 'country', code: 'IT', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 1 },
  { kind: 'country', code: 'FR', name: 'France', flag: '🇫🇷', icon: null, sort_order: 2 },
];

const joes: Pin = { id: 'b1', name: "Joe's Pizza", cuisine_code: 'IT', lat: 46.0, lng: 2.0 };
const chez: Pin = { id: 'b2', name: 'Chez Anne', cuisine_code: 'FR', lat: 48.0, lng: 4.0 };
const pinsAnswer = (pins: Pin[]): PinsResponse => ({ pins, capped: false, too_large: false });

const FAKE_PLACE = 'FAKE_PLACE_oshawa_001';

function details(overrides: Partial<RestaurantDetails> = {}): RestaurantDetails {
  return {
    id: 'b1',
    name: "Joe's Pizza",
    cuisine_code: 'IT',
    accepts_table_requests: true,
    public_address: '100 King St, Oshawa, ON, Canada',
    place_id: FAKE_PLACE,
    currency_code: 'CAD',
    photos: [
      { id: 'ph1', kind: 'cover', path: 'b1/cover.jpg', position: null, menu_item_id: null },
      { id: 'ph2', kind: 'gallery', path: 'b1/g1.jpg', position: 1, menu_item_id: null },
      { id: 'ph3', kind: 'gallery', path: 'b1/g2.jpg', position: 2, menu_item_id: null },
      { id: 'ph4', kind: 'menu', path: 'b1/menu1.jpg', position: 1, menu_item_id: null },
      { id: 'ph5', kind: 'item', path: 'b1/item1.jpg', position: null, menu_item_id: 'i1' },
    ],
    items: [
      {
        id: 'i1',
        name: 'Margherita pizza',
        description: 'San Marzano tomato and basil.',
        price_minor: 1695,
        is_available: true,
        position: 1,
      },
      {
        id: 'i2',
        name: 'Tiramisu',
        description: null,
        price_minor: 995,
        is_available: false,
        position: 2,
      },
      {
        id: 'i3',
        name: "Chef's thali",
        description: null,
        price_minor: null,
        is_available: true,
        position: 3,
      },
    ],
    ...overrides,
  };
}

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

async function openJoes() {
  await fireEvent.press(await screen.findByRole('button', { name: "Joe's Pizza, Italy cuisine" }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('map.locationPromptDismissed', '1');
  animateToRegion.mockClear();
  snapToIndex.mockClear();
  closeSheet.mockClear();
  fetchPins.mockReset();
  fetchPins.mockResolvedValue(pinsAnswer([joes, chez]));
  fetchDetails.mockReset();
  fetchDetails.mockResolvedValue(details());
  jest.mocked(listCuisines).mockResolvedValue(catalog);
  jest.mocked(getCurrencies).mockResolvedValue([
    { code: 'CAD', name: 'Canadian dollar', minor_units: 2 },
    { code: 'JPY', name: 'Japanese yen', minor_units: 0 },
  ]);
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_bucket, paths) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
  );
  jest
    .mocked(getLocales)
    .mockReturnValue([{ regionCode: 'FR', languageTag: 'en-US' }] as unknown as ReturnType<
      typeof getLocales
    >);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('collapsedSnap', () => {
  it('is 15% of the screen at the normal text size', () => {
    expect(collapsedSnap(844, 1, 44)).toBe(Math.round(844 * 0.15));
  });

  it('grows with the system font scale so the name and flag stay visible', () => {
    expect(collapsedSnap(844, 2, 44)).toBeGreaterThan(collapsedSnap(844, 1, 44));
    expect(collapsedSnap(844, 2, 44)).toBe(176);
  });

  it('never grows past half the screen', () => {
    expect(collapsedSnap(844, 10, 44)).toBe(422);
  });
});

describe('RestaurantSheet: opening and closing', () => {
  it('mounts nothing while closed, and is set up to open at half and swipe down to close', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: /Joe's Pizza/ });
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.index).toBe(-1);
    expect(sheet.props.enablePanDownToClose).toBe(true);
    expect(sheet.props.enableDynamicSizing).toBe(false);
    expect(sheet.props.snapPoints.slice(1)).toEqual(['50%', '92%']);
  });

  it('tapping a flag opens the sheet at half, without moving the map', async () => {
    await renderScreen();
    await openJoes();
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(animateToRegion).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('sheet-title')).getByText("Joe's Pizza")).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-title').props.accessibilityRole).toBe('header');
  });

  it('moves a screen reader to the title when it opens', async () => {
    await renderScreen();
    await openJoes();
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
      expect.anything(),
      'focus',
    );
  });

  it('swiping down closes it and clears the selection', async () => {
    await renderScreen();
    await openJoes();
    const ring = () =>
      StyleSheet.flatten(screen.getAllByTestId('flag-pill')[0].props.style).borderWidth;
    const selectedRing = ring();
    await act(async () => screen.getByTestId('bottom-sheet').props.onClose());
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
    expect(ring()).toBeLessThan(selectedRing as number);
  });

  it('the Close button closes it', async () => {
    await renderScreen();
    await openJoes();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
    await waitFor(() => expect(closeSheet).toHaveBeenCalled());
  });

  it('tapping the map closes it', async () => {
    await renderScreen();
    await openJoes();
    await act(async () => screen.getByTestId('map-view').props.onPress());
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });

  it('selecting another flag shows that restaurant and snaps to half again', async () => {
    fetchDetails.mockImplementation(async (id) =>
      id === 'b2'
        ? details({ id: 'b2', name: 'Chez Anne', cuisine_code: 'FR', items: [], photos: [] })
        : details(),
    );
    await renderScreen();
    await openJoes();
    snapToIndex.mockClear();
    await fireEvent.press(await screen.findByRole('button', { name: /Chez Anne/ }));
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(within(screen.getByTestId('sheet-title')).getByText('Chez Anne')).toBeOnTheScreen();
  });

  it('keeps a screen reader inside the sheet only while it is up (half or full)', async () => {
    await renderScreen();
    await openJoes();
    const body = () => screen.getByLabelText('Restaurant details');
    expect(body().props.accessibilityViewIsModal).toBe(false);
    await act(async () => screen.getByTestId('bottom-sheet').props.onChange(1));
    expect(body().props.accessibilityViewIsModal).toBe(true);
    await act(async () => screen.getByTestId('bottom-sheet').props.onChange(0));
    expect(body().props.accessibilityViewIsModal).toBe(false);
  });

  it('has a Close button that is a labelled button of at least 44', async () => {
    await renderScreen();
    await openJoes();
    const close = screen.getByRole('button', { name: 'Close' });
    const style = StyleSheet.flatten(close.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });
});

describe('RestaurantSheet: details', () => {
  it('shows the name and flag at once, and skeleton rows while it loads', async () => {
    fetchDetails.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    await openJoes();
    expect(within(screen.getByTestId('sheet-title')).getByText("Joe's Pizza")).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Loading restaurant' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Italy')).toBeOnTheScreen(); // CuisineLabel: flag + name
  });

  it('shows exactly: photos, menu with prices and availability, address, Directions', async () => {
    await renderScreen();
    await openJoes();
    expect(await screen.findByText('100 King St, Oshawa, ON, Canada')).toBeOnTheScreen();

    // Cover and gallery, named "<Name>, photo n of m".
    expect(screen.getByRole('image', { name: "Joe's Pizza, photo 1 of 3" })).toBeOnTheScreen();
    expect(screen.getByRole('image', { name: "Joe's Pizza, photo 3 of 3" })).toBeOnTheScreen();
    // Menu page and item photo.
    expect(screen.getByRole('image', { name: "Joe's Pizza, menu page 1 of 1" })).toBeOnTheScreen();
    expect(screen.getByRole('image', { name: 'Photo of Margherita pizza' })).toBeOnTheScreen();

    // Items: price in the business's currency, written availability, description.
    expect(
      screen.getByLabelText(/^Margherita pizza, CA\$16\.95, Available, San Marzano/),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Tiramisu, CA$9.95, Sold out')).toBeOnTheScreen();
    expect(screen.getByLabelText("Chef's thali, Price not listed, Available")).toBeOnTheScreen();
    expect(screen.getByText('CA$16.95 · Available')).toBeOnTheScreen();
    expect(screen.getByText('CA$9.95 · Sold out')).toBeOnTheScreen();
    expect(screen.getByText('Price not listed · Available')).toBeOnTheScreen();

    // Address and Directions.
    expect(
      screen.getByRole('button', { name: "Directions to Joe's Pizza in Google Maps" }),
    ).toBeOnTheScreen();
  });

  it('has no Request, Report or placeholder buttons', async () => {
    await renderScreen();
    await openJoes();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    expect(screen.queryByText(/request|report|order|table|pickup/i)).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /request|report|pickup|table/i }),
    ).not.toBeOnTheScreen();
  });

  it("formats prices in the business's own currency, not a default", async () => {
    fetchDetails.mockResolvedValue(
      details({
        currency_code: 'JPY',
        items: [
          {
            id: 'i1',
            name: 'Ramen',
            description: null,
            price_minor: 1500,
            is_available: true,
            position: 1,
          },
        ],
      }),
    );
    await renderScreen();
    await openJoes();
    expect(await screen.findByLabelText(/^Ramen, ¥1,500, Available/)).toBeOnTheScreen();
    expect(screen.queryByText(/CA\$|US\$/)).not.toBeOnTheScreen();
  });

  it('hides a price rather than guess when the currency is unknown to the app', async () => {
    fetchDetails.mockResolvedValue(details({ currency_code: 'ZZZ' }));
    await renderScreen();
    await openJoes();
    expect(
      await screen.findByLabelText('Margherita pizza, Available, San Marzano tomato and basil.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/\d+\.\d\d/)).not.toBeOnTheScreen();
    expect(screen.getByText('Available')).toBeOnTheScreen();
    expect(screen.getByText('Sold out')).toBeOnTheScreen();
  });

  it('shows a calm placeholder when there are no photos, and "No menu yet" with no menu', async () => {
    fetchDetails.mockResolvedValue(details({ photos: [], items: [] }));
    await renderScreen();
    await openJoes();
    expect(await screen.findByText('No photos yet')).toBeOnTheScreen();
    expect(screen.getByText('No menu yet.')).toBeOnTheScreen();
    expect(mockedSignedUrls).not.toHaveBeenCalled();
  });

  it('says so when the restaurant is not available, and Close closes the sheet', async () => {
    fetchDetails.mockResolvedValue(null);
    await renderScreen();
    await openJoes();
    expect(await screen.findByText("This restaurant isn't available right now.")).toBeOnTheScreen();
    // The header's Close and the one beside the message.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    expect(closeButtons).toHaveLength(2);
    await fireEvent.press(closeButtons[1]);
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });

  it('shows an error with Retry, and Retry loads it', async () => {
    fetchDetails.mockRejectedValueOnce(new MapAppError('unknown'));
    fetchDetails.mockRejectedValueOnce(new MapAppError('unknown'));
    await renderScreen();
    await openJoes();
    expect(
      await screen.findByText("We couldn't load restaurants. Try again.", undefined, {
        timeout: 4000,
      }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('100 King St, Oshawa, ON, Canada')).toBeOnTheScreen();
  });

  it('is calm about a rate limit: a note and Try again, no error styling, no automatic retry', async () => {
    fetchDetails.mockRejectedValue(new MapAppError('rate_limited'));
    await renderScreen();
    await openJoes();
    expect(await screen.findByText('Try again in a moment')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1300)));
    expect(fetchDetails).toHaveBeenCalledTimes(1);
    fetchDetails.mockResolvedValue(details());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('100 King St, Oshawa, ON, Canada')).toBeOnTheScreen();
  });
});

describe('RestaurantSheet: Directions', () => {
  it('opens the Google Maps URL for the place, and nothing else', async () => {
    await renderScreen();
    await openJoes();
    await fireEvent.press(
      await screen.findByRole('button', { name: "Directions to Joe's Pizza in Google Maps" }),
    );
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const url = jest.mocked(Linking.openURL).mock.calls[0][0];
    expect(url).toBe(buildDirectionsUrl("Joe's Pizza", FAKE_PLACE));
    expect(url).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(url).toContain(`query_place_id=${FAKE_PLACE}`);
    expect(url).not.toMatch(/apple|geo:|46\.0|2\.0/);
  });

  it('says so if Google Maps cannot be opened', async () => {
    jest.mocked(Linking.openURL).mockRejectedValue(new Error('cannot open'));
    await renderScreen();
    await openJoes();
    await fireEvent.press(
      await screen.findByRole('button', { name: "Directions to Joe's Pizza in Google Maps" }),
    );
    expect(await screen.findByText("Couldn't open Google Maps.")).toBeOnTheScreen();
  });
});

describe('RestaurantSheet: photos', () => {
  it('asks for signed URLs once, for the stored paths, in the media bucket', async () => {
    await renderScreen();
    await openJoes();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    await waitFor(() => expect(mockedSignedUrls).toHaveBeenCalledTimes(1));
    expect(mockedSignedUrls).toHaveBeenCalledWith(
      'business-media',
      ['b1/cover.jpg', 'b1/g1.jpg', 'b1/g2.jpg', 'b1/item1.jpg', 'b1/menu1.jpg'],
      3600,
    );
  });

  it('renews an expired link once, then shows "Photo unavailable" once (no loop)', async () => {
    fetchDetails.mockResolvedValue(details({ photos: [details().photos[0]], items: [] }));
    await renderScreen();
    await openJoes();
    const image = async () => (await screen.findByTestId('expo-image')).props;
    expect((await image()).source.uri).toBe('https://signed.test/b1/cover.jpg');

    await act(async () => (await image()).onError());
    await waitFor(() => expect(mockedSignedUrls).toHaveBeenCalledTimes(2)); // renewed once
    expect(screen.queryByText('Photo unavailable')).not.toBeOnTheScreen();

    await act(async () => (await image()).onError());
    expect(await screen.findByText('Photo unavailable')).toBeOnTheScreen();
    expect(mockedSignedUrls).toHaveBeenCalledTimes(2); // no third request
  });
});

describe('RestaurantSheet: Places in this area', () => {
  it('is a labelled button that opens a list of the pins at half', async () => {
    await renderScreen();
    const button = await screen.findByRole('button', { name: 'Places in this area' });
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(button);
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(
      within(screen.getByTestId('sheet-title')).getByText('Places in this area'),
    ).toBeOnTheScreen();
    const rows = within(screen.getByTestId('bottom-sheet'));
    expect(rows.getByRole('button', { name: "Joe's Pizza, Italy cuisine" })).toBeOnTheScreen();
    expect(rows.getByRole('button', { name: 'Chez Anne, France cuisine' })).toBeOnTheScreen();
    expect(animateToRegion).not.toHaveBeenCalled();
  });

  it('lists rows in name order', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    // Markers are buttons too; the list rows are the ones inside the sheet.
    const rows = within(screen.getByTestId('bottom-sheet'))
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel as string)
      .filter((label) => /cuisine$/.test(label));
    expect(rows).toEqual(['Chez Anne, France cuisine', "Joe's Pizza, Italy cuisine"]);
  });

  it('selecting a row opens that restaurant and centres the map on it with a short move', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    snapToIndex.mockClear();
    const sheet = within(screen.getByTestId('bottom-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name: "Joe's Pizza, Italy cuisine" }));
    expect(await screen.findByText('100 King St, Oshawa, ON, Canada')).toBeOnTheScreen();
    expect(within(screen.getByTestId('sheet-title')).getByText("Joe's Pizza")).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-title')).queryByText('Places in this area'),
    ).not.toBeOnTheScreen();
    expect(snapToIndex).toHaveBeenCalledWith(1);
    // One camera move, to the pin at neighbourhood zoom, a quarter-view south of it so the
    // pin is not hidden behind the half-open sheet.
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    const [target, duration] = animateToRegion.mock.calls[0];
    expect(target.longitude).toBe(2.0);
    expect(target.latitudeDelta).toBe(0.02);
    expect(target.longitudeDelta).toBe(0.02);
    expect(target.latitude).toBeCloseTo(46.0 - 0.02 * 0.25, 10);
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(1000);
  });

  it('keeps a zoom that is already close when picking from the list', async () => {
    await renderScreen();
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        latitude: 46,
        longitude: 2,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    const sheet = within(screen.getByTestId('bottom-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name: 'Chez Anne, France cuisine' }));
    const [target] = animateToRegion.mock.calls[0];
    expect(target.latitudeDelta).toBe(0.01);
    expect(target.longitude).toBe(4.0);
  });

  it('does NOT move the map when a flag is tapped on the map', async () => {
    await renderScreen();
    await openJoes();
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(animateToRegion).not.toHaveBeenCalled();
  });

  it('says so when there is nothing in the area', async () => {
    fetchPins.mockResolvedValue(pinsAnswer([]));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    expect(
      await screen.findByText('No restaurants shown here. Zoom in or move the map.'),
    ).toBeOnTheScreen();
  });

  it('is not offered on a view that is too wide', async () => {
    await renderScreen();
    await screen.findByRole('button', { name: 'Places in this area' });
    await act(async () => {
      screen.getByTestId('map-view').props.onRegionChangeComplete({
        latitude: 0,
        longitude: 0,
        latitudeDelta: 100,
        longitudeDelta: 100,
      });
    });
    expect(screen.queryByRole('button', { name: 'Places in this area' })).not.toBeOnTheScreen();
  });

  it('closes with the Close button', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });
});

describe('RestaurantSheet: stacked screens (list, then a restaurant)', () => {
  const closeButton = () => screen.queryByRole('button', { name: 'Close' });
  const backButton = () => screen.queryByRole('button', { name: 'Back to list' });
  const listTitle = () =>
    within(screen.getByTestId('sheet-title')).queryByText('Places in this area');

  async function openFromList(name = "Joe's Pizza, Italy cuisine") {
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    const sheet = within(screen.getByTestId('bottom-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name }));
  }

  it('a restaurant opened from the list has an X called "Back to list" (and no separate button)', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    expect(screen.getAllByRole('button', { name: 'Back to list' })).toHaveLength(1);
    expect(closeButton()).not.toBeOnTheScreen();
    const style = StyleSheet.flatten(backButton()?.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });

  it('tapping that X returns to the list, keeps the sheet open and leaves the map where it is', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    animateToRegion.mockClear();
    closeSheet.mockClear();
    await fireEvent.press(backButton() as never);
    expect(listTitle()).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('bottom-sheet')).getByRole('button', {
        name: 'Chez Anne, France cuisine',
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('100 King St, Oshawa, ON, Canada')).not.toBeOnTheScreen();
    expect(animateToRegion).not.toHaveBeenCalled();
    expect(closeSheet).not.toHaveBeenCalled();
    // Now on the list: the X closes everything.
    expect(closeButton()).toBeOnTheScreen();
    expect(backButton()).not.toBeOnTheScreen();
  });

  it('swiping down past the lowest snap also returns to the list, and reopens it at half', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    animateToRegion.mockClear();
    snapToIndex.mockClear();
    await act(async () => screen.getByTestId('bottom-sheet').props.onClose());
    expect(listTitle()).toBeOnTheScreen();
    expect(screen.queryByText('100 King St, Oshawa, ON, Canada')).not.toBeOnTheScreen();
    expect(snapToIndex).toHaveBeenCalledWith(1);
    expect(animateToRegion).not.toHaveBeenCalled();
  });

  it('goes back as soon as the swipe starts to close the sheet (no close-and-reopen flash)', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    // Moving between snaps is not a close.
    await act(async () => screen.getByTestId('bottom-sheet').props.onAnimate(1, 2));
    expect(screen.getByText('100 King St, Oshawa, ON, Canada')).toBeOnTheScreen();
    // Heading for "closed" is.
    await act(async () => screen.getByTestId('bottom-sheet').props.onAnimate(0, -1));
    expect(listTitle()).toBeOnTheScreen();
  });

  it('a swipe down that starts closing and then reports closed keeps the list open', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    const sheet = () => screen.getByTestId('bottom-sheet').props;
    // The library announces the animation first, then (if it was not interrupted) onClose.
    await act(async () => sheet().onAnimate(1, -1));
    await act(async () => sheet().onClose());
    expect(listTitle()).toBeOnTheScreen();
    // The list reopens; a later real close from the list closes everything.
    await act(async () => sheet().onAnimate(-1, 1));
    await act(async () => sheet().onClose());
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });

  it('a swipe back that is interrupted by the reopen does not swallow a later real close', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    const sheet = () => screen.getByTestId('bottom-sheet').props;
    await act(async () => sheet().onAnimate(1, -1)); // back to the list; no onClose follows
    await act(async () => sheet().onAnimate(-1, 1)); // the list reopens at half
    await act(async () => sheet().onClose()); // the person swipes the list away
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });

  it('from the list itself, the X and a swipe down close everything', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    expect(closeButton()).toBeOnTheScreen();
    expect(backButton()).not.toBeOnTheScreen();
    await fireEvent.press(closeButton() as never);
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Places in this area' }));
    await act(async () => screen.getByTestId('bottom-sheet').props.onClose());
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
    // Heading for "closed" from the list is not a "back".
    await fireEvent.press(screen.getByRole('button', { name: 'Places in this area' }));
    await act(async () => screen.getByTestId('bottom-sheet').props.onAnimate(1, -1));
    expect(listTitle()).toBeOnTheScreen();
  });

  it('a restaurant opened from a flag just closes: the X is "Close", and swiping down closes', async () => {
    await renderScreen();
    await openJoes();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    expect(closeButton()).toBeOnTheScreen();
    expect(backButton()).not.toBeOnTheScreen();
    await act(async () => screen.getByTestId('bottom-sheet').props.onClose());
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });

  it('tapping the bare map clears the whole stack', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    await act(async () =>
      screen.getByTestId('map-view').props.onPress({ nativeEvent: { action: 'press' } }),
    );
    expect(screen.queryByTestId('sheet-title')).not.toBeOnTheScreen();
  });

  it('can pick another place after going back, and centres on it', async () => {
    fetchDetails.mockImplementation(async (id) =>
      id === 'b2'
        ? details({ id: 'b2', name: 'Chez Anne', cuisine_code: 'FR', items: [], photos: [] })
        : details(),
    );
    await renderScreen();
    await openFromList();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back to list' }));
    animateToRegion.mockClear();
    const sheet = within(screen.getByTestId('bottom-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name: 'Chez Anne, France cuisine' }));
    expect(within(screen.getByTestId('sheet-title')).getByText('Chez Anne')).toBeOnTheScreen();
    expect(animateToRegion).toHaveBeenCalledTimes(1);
    expect(animateToRegion.mock.calls[0][0].longitude).toBe(4.0);
    expect(backButton()).toBeOnTheScreen();
  });

  it('is forgotten once everything is closed: a later flag tap shows "Close"', async () => {
    await renderScreen();
    await openFromList();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    await act(async () =>
      screen.getByTestId('map-view').props.onPress({ nativeEvent: { action: 'press' } }),
    );
    await openJoes();
    await screen.findByText('100 King St, Oshawa, ON, Canada');
    expect(backButton()).not.toBeOnTheScreen();
    expect(closeButton()).toBeOnTheScreen();
  });

  it('the "not available" button also says "Back to list" and goes back', async () => {
    fetchDetails.mockResolvedValue(null);
    await renderScreen();
    await openFromList();
    expect(await screen.findByText("This restaurant isn't available right now.")).toBeOnTheScreen();
    const buttons = screen.getAllByRole('button', { name: 'Back to list' });
    expect(buttons).toHaveLength(2); // the X and the button beside the message
    await fireEvent.press(buttons[1]);
    expect(listTitle()).toBeOnTheScreen();
  });
});

describe('RestaurantSheet: large text', () => {
  const titleText = (name: string) => within(screen.getByTestId('sheet-title')).getByText(name);

  it('caps only the title: 1.6 times for a restaurant name', async () => {
    expect(SHEET_TITLE_MAX_FONT_MULTIPLIER).toBe(1.6);
    await renderScreen();
    await openJoes();
    expect(titleText("Joe's Pizza").props.maxFontSizeMultiplier).toBe(1.6);
  });

  it('caps the list title the same way', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    expect(titleText('Places in this area').props.maxFontSizeMultiplier).toBe(1.6);
  });

  it('leaves list rows scaling fully', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Places in this area' }));
    const rows = within(screen.getByTestId('bottom-sheet'));
    expect(rows.getByText('Chez Anne').props.maxFontSizeMultiplier).toBeUndefined();
    expect(rows.getByText('France').props.maxFontSizeMultiplier).toBeUndefined();
  });

  it('leaves the cuisine, address, menu, prices and buttons scaling fully', async () => {
    await renderScreen();
    await openJoes();
    const address = await screen.findByText('100 King St, Oshawa, ON, Canada');
    const sheet = within(screen.getByTestId('bottom-sheet'));
    const uncapped = [
      address,
      sheet.getByText('Address'),
      sheet.getByText('Menu'),
      sheet.getByText('Margherita pizza'),
      sheet.getByText('CA$16.95 · Available'),
      sheet.getByText('San Marzano tomato and basil.'),
      sheet.getByText('Italy', { includeHiddenElements: true }),
      sheet.getByText('Directions'),
    ];
    for (const node of uncapped) {
      expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    }
  });
});
