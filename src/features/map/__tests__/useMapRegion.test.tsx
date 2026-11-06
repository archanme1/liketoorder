import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { REGION_DEBOUNCE_MS, useMapRegion } from '../hooks/useMapRegion';
import { readLastRegion } from '../lastRegion';

const opening = { latitude: 10, longitude: 20, latitudeDelta: 2, longitudeDelta: 2 };
const moveA = { latitude: 11, longitude: 21, latitudeDelta: 1, longitudeDelta: 1 };
const moveB = { latitude: 12, longitude: 22, latitudeDelta: 1, longitudeDelta: 1 };

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useMapRegion', () => {
  it('has no box until there is an opening view', async () => {
    const { result } = await renderHook(() => useMapRegion(null));
    expect(result.current.box).toBeNull();
    expect(result.current.region).toBeNull();
  });

  it('settles the opening view at once, without waiting for the debounce', async () => {
    const { result } = await renderHook(() => useMapRegion(opening));
    expect(result.current.box).toEqual({ minLat: 9, maxLat: 11, minLng: 19, maxLng: 21 });
    expect(result.current.region).toEqual(opening);
  });

  it('waits 400 ms after the last move before changing the box', async () => {
    expect(REGION_DEBOUNCE_MS).toBe(400);
    const { result } = await renderHook(() => useMapRegion(opening));
    const openingBox = result.current.box;

    await act(async () => result.current.onRegionChangeComplete(moveA));
    expect(result.current.region).toEqual(moveA); // the live region follows at once
    expect(result.current.box).toBe(openingBox); // the box does not

    await advance(399);
    expect(result.current.box).toBe(openingBox);
    await advance(1);
    expect(result.current.box).toEqual({ minLat: 10.5, maxLat: 11.5, minLng: 20.5, maxLng: 21.5 });
  });

  it('sends only the latest of several quick moves', async () => {
    const { result } = await renderHook(() => useMapRegion(opening));
    await act(async () => result.current.onRegionChangeComplete(moveA));
    await advance(300);
    await act(async () => result.current.onRegionChangeComplete(moveB));
    await advance(300); // 600 ms since the first move, 300 since the second
    expect(result.current.box?.minLat).toBe(9); // still the opening box
    await advance(100);
    expect(result.current.box).toEqual({ minLat: 11.5, maxLat: 12.5, minLng: 21.5, maxLng: 22.5 });
  });

  it('saves the last viewed region only once the person stops', async () => {
    const { result } = await renderHook(() => useMapRegion(opening));
    await act(async () => result.current.onRegionChangeComplete(moveA));
    await advance(399);
    expect(await readLastRegion()).toBeNull();
    await advance(1);
    expect(await readLastRegion()).toEqual(moveA);
  });
});
