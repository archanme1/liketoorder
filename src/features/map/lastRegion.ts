import AsyncStorage from '@react-native-async-storage/async-storage';

import { isValidRegion, type MapRegion } from './region';

// Phone-only storage. The last viewed *region* is the only map data kept, and it never leaves the
// phone. Every call is wrapped: storage can be missing or full, and must never block the map.
export const REGION_KEY = 'map.lastRegion';
export const HOMEMADE_REGION_KEY = 'map.lastRegion.homemade';
const PROMPT_DISMISSED_KEY = 'map.locationPromptDismissed';

/** `key` is per tab; the default is the Restaurants tab's key. */
export async function readLastRegion(key: string = REGION_KEY): Promise<MapRegion | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidRegion(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveLastRegion(region: MapRegion, key: string = REGION_KEY): Promise<void> {
  try {
    // Store only the four numbers, never anything else the caller may have attached.
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ latitude, longitude, latitudeDelta, longitudeDelta }),
    );
  } catch {
    // Ignore: the next launch simply falls back to the phone's country.
  }
}

/** True once the person tapped "Not now" on the location note. */
export async function readLocationPromptDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPT_DISMISSED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveLocationPromptDismissed(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPT_DISMISSED_KEY, '1');
  } catch {
    // Ignore: the note may show again next launch.
  }
}
