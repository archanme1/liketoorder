import { Platform } from 'react-native';

import { env } from '@/lib/env';

type MapKeys = {
  EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY?: string;
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?: string;
};

/** The variable the current platform needs, for the development-only hint. */
export function mapKeyName(os: string): string {
  return os === 'android'
    ? 'EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY'
    : 'EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY';
}

/** True when the Maps SDK key for this platform is set. Web has no map. */
export function isMapConfigured(keys: MapKeys, os: string): boolean {
  if (os === 'android') return Boolean(keys.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY);
  if (os === 'ios') return Boolean(keys.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY);
  return false;
}

export function useMapConfigured(): boolean {
  return isMapConfigured(env, Platform.OS);
}
