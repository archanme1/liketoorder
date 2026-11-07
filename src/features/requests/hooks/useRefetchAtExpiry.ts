import { useEffect, useRef } from 'react';

import { clockOffset, msUntilExpiry } from '../status';

const EXTRA_MS = 1_000;

/**
 * Re-reads the data just after the earliest visible pending request expires, timed on the SERVER's
 * clock: the offset is how far the phone's clock was from `serverNow` when the data arrived. A
 * wrong phone clock can only make this refetch early or late; the status shown always comes from
 * the server's display_status.
 */
export function useRefetchAtExpiry(
  pending: readonly { expires_at: string }[],
  serverNow: string | undefined,
  fetchedAt: number,
  refetch: () => void,
): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  const earliest = pending.reduce<string | null>(
    (best, request) => (best === null || request.expires_at < best ? request.expires_at : best),
    null,
  );

  useEffect(() => {
    if (earliest === null || serverNow === undefined) return;
    const offset = clockOffset(serverNow, fetchedAt);
    const wait = msUntilExpiry(earliest, offset, Date.now()) + EXTRA_MS;
    const timer = setTimeout(() => refetchRef.current(), wait);
    return () => clearTimeout(timer);
  }, [earliest, serverNow, fetchedAt]);
}
