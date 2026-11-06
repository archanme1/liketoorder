import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';

import { resolveFallbackView, useInitialRegion } from '../hooks/useInitialRegion';
import type { LocationState, Position } from '../hooks/useLocationPermission';
import { getCountryView } from '../countryViews';
import { WORLD_REGION } from '../region';

const mockedLocales = jest.mocked(getLocales);
const last = { latitude: 1, longitude: 2, latitudeDelta: 0.5, longitudeDelta: 0.5 };

function locale(regionCode: string | null) {
  mockedLocales.mockReturnValue([{ regionCode }] as unknown as ReturnType<typeof getLocales>);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  locale('US');
});

describe('resolveFallbackView', () => {
  it('prefers the last region, then the phone country, then the world', () => {
    expect(resolveFallbackView(last, 'US')).toEqual({ region: last, source: 'last' });
    expect(resolveFallbackView(null, 'US')).toEqual({
      region: getCountryView('US'),
      source: 'country',
    });
    expect(resolveFallbackView(null, null)).toEqual({ region: WORLD_REGION, source: 'world' });
    expect(resolveFallbackView(null, '001')).toEqual({ region: WORLD_REGION, source: 'world' });
    expect(resolveFallbackView(null, 'ZZ')).toEqual({ region: WORLD_REGION, source: 'world' });
  });
});

function setup(
  permission: LocationState,
  getPosition: jest.Mock<Promise<Position | null>, []> = jest.fn(async () => null),
) {
  return renderHook(
    (props: { permission: LocationState }) =>
      useInitialRegion({ permission: props.permission, getPosition }),
    { initialProps: { permission } },
  ).then((hook) => ({ ...hook, getPosition }));
}

describe('useInitialRegion', () => {
  it('opens on the last viewed region when one was saved', async () => {
    await AsyncStorage.setItem('map.lastRegion', JSON.stringify(last));
    const { result } = await setup('denied');
    await waitFor(() => expect(result.current.opening).toEqual({ region: last, source: 'last' }));
  });

  it('opens on the phone country when there is no saved region', async () => {
    locale('FR');
    const { result } = await setup('denied');
    await waitFor(() => expect(result.current.opening?.source).toBe('country'));
    expect(result.current.opening?.region).toEqual(getCountryView('FR'));
  });

  it('opens on the world map when the locale has no country', async () => {
    locale(null);
    const { result } = await setup('denied');
    await waitFor(() => expect(result.current.opening?.source).toBe('world'));
  });

  it('opens on the world map when reading the locale throws', async () => {
    mockedLocales.mockImplementation(() => {
      throw new Error('no locale');
    });
    const { result } = await setup('denied');
    await waitFor(() => expect(result.current.opening?.source).toBe('world'));
  });

  it.each<LocationState>(['unknown', 'undetermined', 'denied', 'denied_forever', 'services_off'])(
    'never asks for a position when location is %s',
    async (permission) => {
      const { result, getPosition } = await setup(permission);
      await waitFor(() => expect(result.current.opening).not.toBeNull());
      expect(getPosition).not.toHaveBeenCalled();
      expect(result.current.myRegion).toBeNull();
    },
  );

  it('moves to the person at neighbourhood zoom once allowed and a position arrives', async () => {
    const getPosition = jest.fn(async () => ({ latitude: 48.85, longitude: 2.35 }));
    const { result } = await setup('granted', getPosition);
    await waitFor(() =>
      expect(result.current.myRegion).toEqual({
        latitude: 48.85,
        longitude: 2.35,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }),
    );
    expect(getPosition).toHaveBeenCalledTimes(1);
    // The fallback view was available the whole time.
    expect(result.current.opening).not.toBeNull();
  });

  it('asks for the position when permission becomes granted later', async () => {
    const getPosition = jest.fn(async () => ({ latitude: 5, longitude: 6 }));
    const { result, rerender } = await setup('undetermined', getPosition);
    await waitFor(() => expect(result.current.opening).not.toBeNull());
    expect(getPosition).not.toHaveBeenCalled();
    await rerender({ permission: 'granted' });
    await waitFor(() => expect(result.current.myRegion?.latitude).toBe(5));
  });

  it('is not blocked by a slow position: the map opens, myRegion stays empty', async () => {
    const getPosition = jest.fn(() => new Promise<Position | null>(() => undefined));
    const { result } = await setup('granted', getPosition);
    await waitFor(() => expect(result.current.opening).not.toBeNull());
    expect(result.current.myRegion).toBeNull();
  });

  it('stays on the fallback when the position fails (null)', async () => {
    const { result, getPosition } = await setup(
      'granted',
      jest.fn(async () => null),
    );
    await waitFor(() => expect(getPosition).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current.myRegion).toBeNull();
    expect(result.current.opening).not.toBeNull();
  });
});
