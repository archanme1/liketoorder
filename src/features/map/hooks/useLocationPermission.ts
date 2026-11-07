import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { readLocationPromptDismissed, saveLocationPromptDismissed } from '../lastRegion';

/** How long one position request may take before the map carries on without it. */
export const POSITION_TIMEOUT_MS = 5000;

export type LocationState =
  | 'unknown' // still checking
  | 'undetermined' // never asked
  | 'granted'
  | 'denied' // said no, the system may still ask again
  | 'denied_forever' // said no, only Settings can change it
  | 'services_off'; // Location Services are off on the phone

export type Position = { latitude: number; longitude: number };

async function readState(): Promise<LocationState> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'services_off';
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === Location.PermissionStatus.GRANTED) return 'granted';
    if (status === Location.PermissionStatus.UNDETERMINED) return 'undetermined';
    return canAskAgain ? 'denied' : 'denied_forever';
  } catch {
    // Treat an unreadable state like "no location": the map still works.
    return 'denied';
  }
}

/**
 * Foreground location only. The position is handed to the caller to move the camera and is never
 * stored, logged or sent anywhere.
 */
export function useLocationPermission() {
  const [state, setState] = useState<LocationState>('unknown');
  // null while the stored "Not now" choice is still loading.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void readState().then((next) => {
      if (mounted.current) setState(next);
    });
    void readLocationPromptDismissed().then((value) => {
      if (mounted.current) setDismissed(value);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Coming back from Settings: pick up whatever the person changed there.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void readState().then((value) => {
          if (mounted.current) setState(value);
        });
      }
    });
    return () => subscription.remove();
  }, []);

  const refresh = useCallback(async (): Promise<LocationState> => {
    const next = await readState();
    if (mounted.current) setState(next);
    return next;
  }, []);

  /** Shows the system prompt. Returns the state afterwards. */
  const request = useCallback(async (): Promise<LocationState> => {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // Fall through: readState reports whatever the system now says.
    }
    return refresh();
  }, [refresh]);

  /** One position, or null when it is slow, unavailable or fails. Never throws. */
  const getPosition = useCallback(async (): Promise<Position | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), POSITION_TIMEOUT_MS);
    });
    const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((result): Position => ({
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
      }))
      .catch(() => null);
    try {
      return await Promise.race([fix, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const dismissPrompt = useCallback(() => {
    setDismissed(true);
    void saveLocationPromptDismissed();
  }, []);

  // The plain-language note shows once, before the system prompt, and only if never asked.
  const showPrompt = state === 'undetermined' && dismissed === false;

  return { state, showPrompt, request, refresh, getPosition, dismissPrompt };
}
