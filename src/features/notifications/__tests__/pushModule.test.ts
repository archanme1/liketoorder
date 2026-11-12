import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import {
  REQUESTS_CHANNEL_ID,
  ensureAndroidChannel,
  getProjectId,
  getPushToken,
  onPushTokenChange,
  readPermission,
  requestPermission,
} from '../pushModule';

import { TEST_TOKEN, deviceToken, fakeNotifications } from '../__fixtures__/notifications';

const fakeDevice = Device as typeof Device & { __setIsDevice: (value: boolean) => void };
const tokenMock = jest.mocked(Notifications.getExpoPushTokenAsync);
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';

// expo-constants under jest-expo exposes expoConfig as a non-configurable getter, so this file
// fakes the two fields pushModule reads. projectId.test.ts checks the real config (no id yet).
const mockProject: { id: string | undefined } = { id: undefined };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { name: 'LikeToOrder', slug: 'liketoorder', extra: { eas: { projectId: mockProject.id } } };
    },
    easConfig: null,
  },
}));

/** The app as built after `eas init`. */
function withProjectId(projectId: string | undefined) {
  mockProject.id = projectId;
}

afterEach(() => {
  mockProject.id = undefined;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('readPermission', () => {
  it.each([
    [{ status: 'undetermined', granted: false }, 'undetermined'],
    [{ status: 'granted', granted: true }, 'granted'],
    [{ status: 'denied', granted: false }, 'denied'],
  ] as const)('maps %j to %s', async (result, expected) => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
      ...result,
      canAskAgain: true,
      expires: 'never',
    } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
    await expect(readPermission()).resolves.toBe(expected);
  });

  it('treats an unreadable permission as denied, without throwing', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(new Error('native'));
    await expect(readPermission()).resolves.toBe('denied');
  });
});

describe('requestPermission', () => {
  it('asks for alerts and sounds but never the app-icon badge, then reads the result', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
    await expect(requestPermission()).resolves.toBe('granted');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
  });

  it('still answers when the prompt fails', async () => {
    jest.mocked(Notifications.requestPermissionsAsync).mockRejectedValueOnce(new Error('native'));
    await expect(requestPermission()).resolves.toBe('undetermined');
  });
});

describe('getProjectId', () => {
  it('is null without an id', () => {
    expect(getProjectId()).toBeNull();
  });

  it('reads extra.eas.projectId when present', () => {
    withProjectId(PROJECT_ID);
    expect(getProjectId()).toBe(PROJECT_ID);
  });

  it('treats an empty id as missing', () => {
    withProjectId('');
    expect(getProjectId()).toBeNull();
  });
});

describe('getPushToken (Decision 19)', () => {
  it('returns the Expo token on a real phone with a project id', async () => {
    withProjectId(PROJECT_ID);
    await expect(getPushToken()).resolves.toBe(TEST_TOKEN);
    expect(tokenMock).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it('on the Simulator: no token, never asks Expo, does not throw', async () => {
    withProjectId(PROJECT_ID);
    fakeDevice.__setIsDevice(false);
    await expect(getPushToken()).resolves.toBeNull();
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('without a project id: no token, never asks Expo, does not throw', async () => {
    await expect(getPushToken()).resolves.toBeNull();
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('when Expo cannot be reached: no token, does not throw', async () => {
    withProjectId(PROJECT_ID);
    tokenMock.mockRejectedValueOnce(new Error('network'));
    await expect(getPushToken()).resolves.toBeNull();
  });

  it('refuses a token the server would refuse', async () => {
    withProjectId(PROJECT_ID);
    tokenMock.mockResolvedValueOnce({ type: 'expo', data: 'not-a-token' });
    await expect(getPushToken()).resolves.toBeNull();
  });
});

describe('ensureAndroidChannel', () => {
  it('does nothing on iOS', async () => {
    await ensureAndroidChannel();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('creates the high-importance requests channel on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await ensureAndroidChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(REQUESTS_CHANNEL_ID, {
      name: 'Requests',
      importance: AndroidImportance.HIGH,
    });
  });
});

describe('onPushTokenChange', () => {
  it('calls back on a token change and unsubscribes cleanly', () => {
    const listener = jest.fn();
    const stop = onPushTokenChange(listener);
    fakeNotifications.__emitToken(deviceToken());
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    expect(fakeNotifications.__listenerCount()).toBe(0);
    fakeNotifications.__emitToken(deviceToken('device-token-2'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
