import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  readLastRegion,
  readLocationPromptDismissed,
  saveLastRegion,
  saveLocationPromptDismissed,
} from '../lastRegion';

const region = { latitude: 10, longitude: 20, latitudeDelta: 1, longitudeDelta: 2 };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('lastRegion', () => {
  it('returns null when nothing was saved', async () => {
    expect(await readLastRegion()).toBeNull();
  });

  it('round-trips a region and stores only its four numbers', async () => {
    await saveLastRegion({ ...region, extra: 'x' } as typeof region);
    expect(await readLastRegion()).toEqual(region);
    const raw = await AsyncStorage.getItem('map.lastRegion');
    expect(Object.keys(JSON.parse(raw ?? '{}')).sort()).toEqual([
      'latitude',
      'latitudeDelta',
      'longitude',
      'longitudeDelta',
    ]);
  });

  it.each(['not json', '{"latitude":99}', 'null', '[]'])('ignores stored junk %p', async (raw) => {
    await AsyncStorage.setItem('map.lastRegion', raw);
    expect(await readLastRegion()).toBeNull();
  });

  it('never throws when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('boom'));
    expect(await readLastRegion()).toBeNull();
    await expect(saveLastRegion(region)).resolves.toBeUndefined();
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    expect(await readLocationPromptDismissed()).toBe(false);
  });

  it('remembers "Not now"', async () => {
    expect(await readLocationPromptDismissed()).toBe(false);
    await saveLocationPromptDismissed();
    expect(await readLocationPromptDismissed()).toBe(true);
  });
});
