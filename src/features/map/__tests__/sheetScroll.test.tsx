import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { getCurrencies } from '@/features/menu/api';
import { space } from '@/theme/tokens';

import { fetchPinsInBounds, fetchRestaurantDetails } from '../api';
import { RestaurantMapScreen } from '../components/RestaurantMapScreen';
import { collapsedSnap, scrollBottomSpace, snapHeights } from '../components/RestaurantSheet';
import type { Pin } from '../schema';

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

const GAP = space.xxl;

describe('snap heights and the space under the scrolling content', () => {
  it('snapHeights: collapsed, half (50%) and full (92%) of the screen area', () => {
    expect(snapHeights(800, 1, 44)).toEqual([120, 400, 736]);
  });

  it('scrollBottomSpace: the lower the snap, the more space the content needs', () => {
    const snaps = [120, 400, 736];
    expect(scrollBottomSpace(snaps, 2, GAP)).toBe(GAP); // full: just the gap
    expect(scrollBottomSpace(snaps, 1, GAP)).toBe(736 - 400 + GAP); // half
    expect(scrollBottomSpace(snaps, 0, GAP)).toBe(736 - 120 + GAP); // collapsed
  });

  it('treats an unknown or closed index as the lowest snap, never negative space', () => {
    const snaps = [120, 400, 736];
    expect(scrollBottomSpace(snaps, -1, GAP)).toBe(scrollBottomSpace(snaps, 0, GAP));
    expect(scrollBottomSpace(snaps, 9, GAP)).toBe(GAP);
    expect(scrollBottomSpace([300], 0, GAP)).toBe(GAP);
  });

  // The model behind the fix. The sheet is as tall as its highest snap, anchored at its top, so
  // at a lower snap only the top part of the scroll view is on screen. With the space above, the
  // end of the content can always be scrolled to `GAP` points above the bottom of what is on
  // screen. (How the real library lays this out is checked in the simulator.)
  it.each([
    [700, 1],
    [800, 1],
    [900, 1],
    [800, 2],
    [800, 3],
  ])(
    'the last row can be scrolled into view at every snap (area %d, font scale %d)',
    (area, fontScale) => {
      const snaps = snapHeights(area, fontScale, 44);
      const highest = Math.max(...snaps);
      const chrome = 110; // handle + header, which sit above the scroll view
      const viewport = highest - chrome;
      for (const contentLength of [400, 1500, 3000]) {
        snaps.forEach((snap, index) => {
          const total = contentLength + scrollBottomSpace(snaps, index, GAP);
          const maxOffset = Math.max(0, total - viewport);
          const lastRowBottom = contentLength - maxOffset; // within the scroll view
          const visibleBottom = snap - chrome; // what is on screen
          if (maxOffset > 0) {
            expect(lastRowBottom).toBeLessThanOrEqual(visibleBottom - GAP + 1e-9);
          } else {
            // Content shorter than the scroll view: nothing to scroll, it simply has to be on screen.
            expect(contentLength).toBeLessThanOrEqual(visibleBottom);
          }
        });
      }
    },
  );

  it('without the extra space, the last row could never reach the screen at half (the bug)', () => {
    const snaps = snapHeights(800, 1, 44);
    const viewport = Math.max(...snaps) - 110;
    const contentLength = 1500;
    const total = contentLength + GAP; // the old, fixed padding
    const lastRowBottom = contentLength - Math.max(0, total - viewport);
    expect(lastRowBottom).toBeGreaterThan(snaps[1] - 110); // below the half-open screen edge
  });

  it('the collapsed snap grows with large text', () => {
    expect(collapsedSnap(800, 3, 44)).toBeGreaterThan(collapsedSnap(800, 1, 44));
  });
});

const joes: Pin = { id: 'b1', name: "Joe's Pizza", cuisine_code: 'IT', lat: 46.0, lng: 2.0 };

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

describe('the sheet applies it', () => {
  const AREA = 800;
  const { fontScale } = Dimensions.get('window');
  const snaps = snapHeights(AREA, fontScale, 44);

  beforeEach(async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('map.locationPromptDismissed', '1');
    jest
      .mocked(fetchPinsInBounds)
      .mockResolvedValue({ pins: [joes], capped: false, too_large: false });
    jest.mocked(fetchRestaurantDetails).mockResolvedValue(null);
    jest.mocked(listCuisines).mockResolvedValue([]);
    jest.mocked(getCurrencies).mockResolvedValue([]);
    jest
      .mocked(getLocales)
      .mockReturnValue([{ regionCode: 'FR' }] as unknown as ReturnType<typeof getLocales>);
  });

  async function openSheet() {
    await renderScreen();
    await act(async () =>
      fireEvent(screen.getByTestId('map-screen'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: AREA } },
      }),
    );
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
  }
  const padding = () =>
    screen.getByTestId('sheet-scroll').props.contentContainerStyle.paddingBottom;

  it('sizes the snaps from the measured screen area, not the window', async () => {
    await openSheet();
    expect(screen.getByTestId('bottom-sheet').props.snapPoints).toEqual([snaps[0], '50%', '92%']);
  });

  it("scrolls inside the library's own scroll view", async () => {
    await openSheet();
    expect(screen.getByTestId('sheet-scroll')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-scroll').props.contentContainerStyle).toBeDefined();
  });

  it('opens with the space for half, and follows the snap it moves to', async () => {
    await openSheet();
    expect(padding()).toBe(snaps[2] - snaps[1] + GAP);

    await act(async () => screen.getByTestId('bottom-sheet').props.onChange(2));
    expect(padding()).toBe(GAP);

    await act(async () => screen.getByTestId('bottom-sheet').props.onChange(0));
    expect(padding()).toBe(snaps[2] - snaps[0] + GAP);
  });

  it('prepares for the snap it is animating to, before it arrives', async () => {
    await openSheet();
    await act(async () => screen.getByTestId('bottom-sheet').props.onAnimate(1, 2));
    expect(padding()).toBe(GAP);
  });
});
