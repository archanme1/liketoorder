import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { PushPlatform } from './api';
import { PUSH_TOKEN_PATTERN } from './schema';

// The one wrapper over expo-notifications, expo-device and the EAS project id. Nothing else in the
// app imports them, so every native call is in one place and every failure is caught here.

export type PermissionState = 'undetermined' | 'granted' | 'denied';

/** The Android channel push-sender names in every message (`channelId: 'requests'`). */
export const REQUESTS_CHANNEL_ID = 'requests';

function toState(result: { status: string; granted: boolean }): PermissionState {
  if (result.granted) return 'granted';
  return result.status === 'denied' ? 'denied' : 'undetermined';
}

/** The phone's notification permission. Never throws: an unreadable state counts as denied. */
export async function readPermission(): Promise<PermissionState> {
  try {
    return toState(await Notifications.getPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/** Shows the system prompt (only shown once by the system), then reads the state again. */
export async function requestPermission(): Promise<PermissionState> {
  try {
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
  } catch {
    // Fall through: readPermission reports whatever the system now says.
  }
  return readPermission();
}

/** The EAS project id, or null when the app has none yet (no `eas init`; Decision 19). */
export function getProjectId(): string | null {
  const extra: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas: unknown = Constants.easConfig?.projectId;
  const id = typeof extra === 'string' && extra ? extra : fromEas;
  return typeof id === 'string' && id ? id : null;
}

export function getPushPlatform(): PushPlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

/**
 * This phone's Expo push token, or null: on the Simulator or an emulator, without an EAS project
 * id, on another platform, or when Expo cannot be reached. Never throws.
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId = getProjectId();
  if (!projectId || !getPushPlatform()) return null;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return PUSH_TOKEN_PATTERN.test(data) ? data : null;
  } catch {
    return null;
  }
}

/** Android 8+ shows a push only through a channel; push-sender sends on `requests`. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(REQUESTS_CHANNEL_ID, {
      name: 'Requests',
      importance: AndroidImportance.HIGH,
    });
  } catch {
    // The system falls back to its default channel.
  }
}

/**
 * A push that arrives while the app is open shows its banner and plays its sound (Decision 13).
 * Never the app-icon badge (Decision 10).
 */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** A tap on a notification: which notification, how it was opened, and its `data`. */
export type PushTap = { identifier: string; isDefaultAction: boolean; data: unknown };

function toTap(response: Notifications.NotificationResponse): PushTap {
  return {
    identifier: response.notification.request.identifier,
    isDefaultAction: response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER,
    data: response.notification.request.content.data,
  };
}

/** The tap that started the app (cold start), or null. Never throws. */
export function getLastTap(): PushTap | null {
  try {
    const response = Notifications.getLastNotificationResponse();
    return response ? toTap(response) : null;
  } catch {
    return null;
  }
}

/** Forgets the cold-start tap, so a later mount does not route it again. */
export function clearLastTap(): void {
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Nothing to clear.
  }
}

/** Calls `listener` for each tap while the app is running (warm). Returns the unsubscribe. */
export function onTap(listener: (tap: PushTap) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
    listener(toTap(response)),
  );
  return () => subscription.remove();
}

/** Calls `listener` with a push's `data` when one arrives while the app is open. */
export function onForegroundPush(listener: (data: unknown) => void): () => void {
  const subscription = Notifications.addNotificationReceivedListener((notification) =>
    listener(notification.request.content.data),
  );
  return () => subscription.remove();
}

/** Calls `listener` when the phone's push token changes. Returns the unsubscribe. */
export function onPushTokenChange(listener: () => void): () => void {
  const subscription = Notifications.addPushTokenListener(() => listener());
  return () => subscription.remove();
}
