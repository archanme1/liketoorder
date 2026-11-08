import { useEffect, useRef } from 'react';

import { clearReturnTo } from '../returnTo';

import { useSession } from './useSession';

/**
 * Forgets where a guest meant to go after signing in when the sign-in screens go away WITHOUT a
 * session: the swipe-back gesture or the Android back button, which do not run the Close control.
 * When they go away because the person did sign in, the return is kept: the root navigator is
 * about to use it, and the request form clears it when it opens.
 */
export function useClearReturnToOnLeave(): void {
  const { session } = useSession();
  const signedIn = useRef(session !== null);
  useEffect(() => {
    signedIn.current = session !== null;
  }, [session]);
  useEffect(
    () => () => {
      if (!signedIn.current) clearReturnTo();
    },
    [],
  );
}
