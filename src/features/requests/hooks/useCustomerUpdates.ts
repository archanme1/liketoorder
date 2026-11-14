import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useSession } from '@/features/auth/hooks/useSession';

import { countMyRequestUpdates, markMyRequestsSeen } from '../api';

import { PENDING_POLL_MS, requestKeys } from './keys';

/**
 * How many of the customer's requests changed since they last opened Sent (spec 10b Decision 7),
 * now kept by the server (spec 12): the same number on every phone. An answer, an expiry,
 * completed and no-show raise it; the customer's own cancel does not. Read every 30 s while the
 * app is in the foreground (polling stays in v1, Decision 16), and again after every Sent list
 * read, so a change the list shows is counted at once. `undefined` while loading or after an
 * error: no number rather than a wrong one.
 * `markSeen` is for the Sent list on screen: it clears the flags, but only when the number is above
 * zero, one call at a time, and then reads the number again.
 */
export function useCustomerUpdates() {
  const client = useQueryClient();
  const { session, isRecovering } = useSession();
  const signedIn = session !== null && !isRecovering;
  const query = useQuery({
    queryKey: requestKeys.updatesCount,
    queryFn: countMyRequestUpdates,
    enabled: signedIn,
    staleTime: 0,
    refetchInterval: PENDING_POLL_MS,
  });
  const count = signedIn && query.isSuccess ? query.data : undefined;

  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        const [root, list] = event.query.queryKey as readonly unknown[];
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          root === requestKeys.mine[0] &&
          list === requestKeys.mine[1]
        ) {
          void client.invalidateQueries({ queryKey: requestKeys.updatesCount });
        }
      }),
    [client],
  );

  const inFlight = useRef(false);
  const markSeen = useCallback(() => {
    if (!signedIn || count === undefined || count <= 0 || inFlight.current) return;
    inFlight.current = true;
    void markMyRequestsSeen()
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        void client.invalidateQueries({ queryKey: requestKeys.updatesCount });
      });
  }, [signedIn, count, client]);

  return { count, markSeen };
}
