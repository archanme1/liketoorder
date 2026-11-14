import { useEffect, useReducer } from 'react';

import { useSession } from '@/features/auth/hooks/useSession';

import { getSignedInUserId, registerPushToken, unregisterPushToken } from '../api';
import { getPushPlatform, getPushToken, onPushTokenChange } from '../pushModule';
import { clearStoredToken, saveStoredToken, trackRegistration } from '../tokenStore';

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
    void trackRegistration(
      (async () => {
        const token = await getPushToken();
        const platform = getPushPlatform();
        if (!token || !platform) return;
        try {
          await registerPushToken(token, platform);
          // Stored so sign-out on this phone can remove it (sign-out waits for this run).
          await saveStoredToken(token);
          // The person changed while the call was out (signed out or switched): take the token
          // back off this user while that is still possible, best effort.
          if ((await getSignedInUserId()) !== userId) {
            await unregisterPushToken(token);
            await clearStoredToken();
          }
        } catch {
          // Ignore: the next app start, sign-in or token change tries again.
        }
      })(),
    );
  }, [userId, isRecovering, state, tokenChanges]);
}
