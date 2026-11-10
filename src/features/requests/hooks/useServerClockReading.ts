import { useEffect, useState } from 'react';

import { clockOffset } from '../status';

/**
 * The longest a setTimeout may wait. The real limit is 2^31 - 1 ms (about 24.8 days): a longer wait
 * fires at once, and a timer that re-arms itself would then loop. A table can be 30 days away, so
 * every timer here is capped and simply looks again when it fires early.
 */
export const MAX_TIMER_MS = 2_000_000_000;

/**
 * The SERVER's time now, in ms: the phone's clock corrected by how far it was from `serverNow` when
 * the data arrived (null until there is a `serverNow`). The phone's clock only schedules the next
 * look: `nextWake` says, for the server time just read, at which server time the answer may change
 * (null when it will not change again), and a capped timer reads the clock again then. A wrong
 * phone clock can make that look early or late, never decide what is shown from the phone's own
 * time. Used for hints only (Completed / No-show, "I've arrived"); the server checks again.
 */
export function useServerClockReading(
  serverNow: string | undefined,
  fetchedAt: number,
  nextWake: (serverMs: number) => number | null,
): number | null {
  // The phone's clock as last read: at mount, and when the timer below fires. A newer fetch
  // (fetchedAt) is a newer reading too.
  const [readAt, setReadAt] = useState(() => Date.now());
  const offset = serverNow === undefined ? null : clockOffset(serverNow, fetchedAt);
  const serverMs = offset === null ? null : Math.max(readAt, fetchedAt) - offset;
  const wakeAt = serverMs === null ? null : nextWake(serverMs);

  useEffect(() => {
    if (offset === null || wakeAt === null) return;
    const wait = Math.max(0, wakeAt + offset - Date.now()) + 1;
    const timer = setTimeout(() => setReadAt(Date.now()), Math.min(wait, MAX_TIMER_MS));
    return () => clearTimeout(timer);
    // readAt is a dependency: if the timer fires a little early (or at the cap), the effect re-arms
    // for the rest.
  }, [wakeAt, offset, readAt]);

  return serverMs;
}
