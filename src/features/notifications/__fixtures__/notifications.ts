import * as Notifications from 'expo-notifications';

// Real shapes (expo-notifications 58) for the fakes in jest.setup.ts: a remote push as the phone
// hands it to the app, and a tap on it. Tokens are obviously fake.

export const TEST_TOKEN = 'ExponentPushToken[test-0001]';
export const OTHER_TEST_TOKEN = 'ExponentPushToken[test-0002]';
export const REQUEST_UUID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

export const fakeNotifications = Notifications as typeof Notifications & {
  __emitReceived: (notification: Notifications.Notification) => void;
  __emitResponse: (response: Notifications.NotificationResponse) => void;
  __setLastResponse: (response: Notifications.NotificationResponse | null | undefined) => void;
  __emitToken: (token: Notifications.DevicePushToken) => void;
  __listenerCount: () => number;
};

export function pushData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, kind: 'pickup', id: REQUEST_UUID, side: 'sent', ...overrides };
}

let counter = 0;

export function makeNotification(
  data: Record<string, unknown> = pushData(),
  identifier = `notification-${(counter += 1)}`,
): Notifications.Notification {
  return {
    date: Date.parse('2026-11-12T12:00:00Z'),
    request: {
      identifier,
      content: {
        title: 'Request accepted',
        subtitle: null,
        body: 'Place accepted your pickup request.',
        data,
        sound: 'default',
      },
      trigger: { type: 'push' },
    },
  } as Notifications.Notification;
}

export function makeResponse(
  data: Record<string, unknown> = pushData(),
  actionIdentifier: string = Notifications.DEFAULT_ACTION_IDENTIFIER,
  identifier?: string,
): Notifications.NotificationResponse {
  return { notification: makeNotification(data, identifier), actionIdentifier };
}

export function deviceToken(data = 'device-token-1'): Notifications.DevicePushToken {
  return { type: 'ios', data };
}
