import { useEffect, useReducer } from 'react';

import { useSession } from '@/features/auth/hooks/useSession';

import { registerPushToken } from '../api';
import { getPushPlatform, getPushToken, onPushTokenChange } from '../pushModule';
import { saveStoredToken } from '../tokenStore';

import { useNotificationPermission } from './useNotificationPermission';

/**
 * Links this phone's push token to the signed-in user: on app start, after sign-in, when the
 * permission becomes granted and when the phone's token changes. Each run also refreshes the
 * server's last_registered_at (tokens not seen for 60 days are dropped). Best effort and silent:
 * on the Simulator, without an EAS project id or without permission it registers nothing.
 */
export function usePushRegistration(): void {
  const { session, isRecovering } = useSession();
  const userId = session?.user.id;
  const { state } = useNotificationPermission();
  const [tokenChanges, tokenChanged] = useReducer((count: number) => count + 1, 0);

  useEffect(() => onPushTokenChange(tokenChanged), []);

  useEffect(() => {
    if (!userId || isRecovering || state !== 'granted') return;
    void (async () => {
      const token = await getPushToken();
      const platform = getPushPlatform();
      if (!token || !platform) return;
      try {
        await registerPushToken(token, platform);
        // Kept even if the person signed out meanwhile: the token is theirs on the server now,
        // and sign-out on this phone needs it to remove it.
        await saveStoredToken(token);
      } catch {
        // Ignore: the next app start, sign-in or token change tries again.
      }
    })();
  }, [userId, isRecovering, state, tokenChanges]);
}
