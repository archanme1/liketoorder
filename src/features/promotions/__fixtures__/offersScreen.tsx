// Test harness for the Offers screen (spec 16 PR 4): the screen in a QueryClient and a SafeArea
// with phone-sized metrics, and a switch for what the mocked expo-location reports.
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Cuisine } from '@/features/cuisines/schema';

import { OffersScreen } from '../components/OffersScreen';
import type { Offer } from '../schema';

export const VIETNAM: Cuisine = {
  kind: 'country',
  code: 'VN',
  name: 'Vietnam',
  flag: String.fromCodePoint(0x1f1fb, 0x1f1f3),
  icon: null,
  sort_order: 1,
};

/** A real position near Oshawa's centre that is not on the grid (snaps to 43.9, -78.85). */
export const RAW_POSITION = { latitude: 43.8971, longitude: -78.8658 };

export type LocationSetup =
  'granted' | 'undetermined' | 'denied' | 'denied_forever' | 'services_off';

/** What the mocked expo-location answers. `fix` null: the position never comes. */
export function setLocation(
  setup: LocationSetup,
  {
    fix = RAW_POSITION as { latitude: number; longitude: number } | null,
    grantOnRequest = true,
  } = {},
) {
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(setup !== 'services_off');
  const status =
    setup === 'granted' ? 'granted' : setup === 'undetermined' ? 'undetermined' : 'denied';
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
    status,
    canAskAgain: setup !== 'denied_forever',
    granted: setup === 'granted',
  } as unknown as Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>>);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => {
    // Asking changes what the next check reads, like the real system prompt.
    if (grantOnRequest) {
      jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({
        status: 'granted',
        canAskAgain: true,
        granted: true,
      } as unknown as Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>>);
    }
    return { status: grantOnRequest ? 'granted' : 'denied' } as unknown as Awaited<
      ReturnType<typeof Location.requestForegroundPermissionsAsync>
    >;
  });
  jest
    .mocked(Location.getCurrentPositionAsync)
    .mockImplementation(
      () =>
        (fix
          ? Promise.resolve({ coords: { latitude: fix.latitude, longitude: fix.longitude } })
          : Promise.reject(new Error('no fix'))) as unknown as ReturnType<
          typeof Location.getCurrentPositionAsync
        >,
    );
}

type ScreenProps = {
  focused?: boolean;
  onOpenOffer?: (offer: Offer) => void;
  onBrowseMap?: () => void;
};

export function offersScreenTree(client: QueryClient, props: ScreenProps = {}) {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <OffersScreen
          focused={props.focused ?? true}
          onOpenOffer={props.onOpenOffer ?? jest.fn()}
          onBrowseMap={props.onBrowseMap ?? jest.fn()}
        />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
