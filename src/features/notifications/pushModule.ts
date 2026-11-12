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

/** Calls `listener` when the phone's push token changes. Returns the unsubscribe. */
export function onPushTokenChange(listener: () => void): () => void {
  const subscription = Notifications.addPushTokenListener(() => listener());
  return () => subscription.remove();
}
