import { useEffect, useState } from 'react';

import { clockOffset, msUntilExpiry } from '../status';

/**
 * Whether the pickup time has passed on the SERVER's clock: the phone's clock corrected by how far
 * it was from `serverNow` when the data arrived. A hint for showing Completed / No-show only; the
 * server checks again and refuses with invalid_transition. Flips by itself at pickup time.
 */
export function usePickupPassed(
  pickupAt: string,
  serverNow: string | undefined,
  fetchedAt: number,
): boolean {
  // The phone's clock as last read: at mount, and when the timer below fires. A newer fetch
  // (fetchedAt) is a newer reading too.
  const [readAt, setReadAt] = useState(() => Date.now());
  const offset = serverNow === undefined ? null : clockOffset(serverNow, fetchedAt);
  const passed =
    offset !== null && new Date(pickupAt).getTime() <= Math.max(readAt, fetchedAt) - offset;

  useEffect(() => {
    if (offset === null || passed) return;
    const wait = msUntilExpiry(pickupAt, offset, Date.now()) + 1;
    const timer = setTimeout(() => setReadAt(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [pickupAt, offset, passed]);

  return passed;
}
