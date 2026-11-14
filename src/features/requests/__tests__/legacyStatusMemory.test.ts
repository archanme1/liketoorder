import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  LEGACY_PREFIX,
  removeLegacyStatusMemory,
  resetLegacyStatusMemoryForTests,
} from '../legacyStatusMemory';

beforeEach(async () => {
  await AsyncStorage.clear();
  resetLegacyStatusMemoryForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('removeLegacyStatusMemory (spec 12)', () => {
  it("removes every user's old seen memory and nothing else", async () => {
    await AsyncStorage.multiSet([
      [`${LEGACY_PREFIX}user-1`, '[]'],
      [`${LEGACY_PREFIX}user-2`, '[]'],
      ['liketoorder.push.token.v1', 'ExponentPushToken[test-0001]'],
      ['liketoorder.notifications.primer.v1.user-1', '1'],
    ]);
    await removeLegacyStatusMemory();
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual([
      'liketoorder.notifications.primer.v1.user-1',
      'liketoorder.push.token.v1',
    ]);
  });

  it('runs once per app run', async () => {
    await removeLegacyStatusMemory();
    await AsyncStorage.setItem(`${LEGACY_PREFIX}user-3`, '[]');
    await removeLegacyStatusMemory();
    expect(await AsyncStorage.getItem(`${LEGACY_PREFIX}user-3`)).toBe('[]');
  });

  it('never throws when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValueOnce(new Error('disk'));
    await expect(removeLegacyStatusMemory()).resolves.toBeUndefined();
  });
});
