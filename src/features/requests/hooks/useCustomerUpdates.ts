import { useCallback, useEffect, useMemo } from 'react';

import { baseline, changedCount, markSeen, useStatusMemory } from '../statusMemory';

import { useMyRequests } from './useMyRequests';
import { useUserId } from './useUserId';

/**
 * How many of the customer's requests changed status since the Sent list was last opened (spec 10b
 * Decision 7). The count is `undefined` (no number) until the phone's memory and the list have both
 * loaded, and whenever the list fails to load. A request seen for the first time is only remembered
 * (a baseline); the change test compares the server's `display_status`, never the phone clock.
 * `markSeen` is for the Sent list: it records everything loaded as seen.
 */
export function useCustomerUpdates() {
  const userId = useUserId();
  const list = useMyRequests({ enabled: userId !== undefined });
  const memory = useStatusMemory(userId);
  const ready = userId !== undefined && memory.phase === 'ready' && list.isSuccess;
  const { requests } = list;

  const count = useMemo(
    () => (ready ? changedCount(memory, requests) : undefined),
    [ready, memory, requests],
  );

  useEffect(() => {
    if (ready) baseline(userId, requests);
  }, [ready, userId, requests]);

  const markAllSeen = useCallback(() => {
    if (ready) markSeen(userId, requests);
  }, [ready, userId, requests]);

  return { count, markSeen: markAllSeen };
}
