import { useEffect, useState } from 'react';

import { clockOffset } from '../status';

const HOUR_MS = 3_600_000;
/** "I've arrived" opens 2 hours before the table time and closes 4 hours after it (both ends allowed). */
export const ARRIVAL_OPENS_BEFORE_MS = 2 * HOUR_MS;
export const ARRIVAL_CLOSES_AFTER_MS = 4 * HOUR_MS;

export type ArrivalWindow = 'before' | 'open' | 'after';

/** Where "now" on the SERVER's clock falls against the arrival window of a table time. */
export function arrivalWindowAt(tableAt: string, serverNowMs: number): ArrivalWindow {
  const at = new Date(tableAt).getTime();
  if (serverNowMs < at - ARRIVAL_OPENS_BEFORE_MS) return 'before';
  if (serverNowMs > at + ARRIVAL_CLOSES_AFTER_MS) return 'after';
  return 'open';
}

/**
 * Whether the arrival window is open, judged on the SERVER's clock: the phone's clock corrected by
 * how far it was from `serverNow` when the data arrived. The phone's clock only schedules the next
 * look (a timer to the moment the window opens or closes); a wrong phone clock can make that look
 * early or late but never decides what is shown from the phone's own time. A hint for showing the
 * button only: the server checks again and refuses with arrival_window.
 */
export function useArrivalWindow(
  tableAt: string,
  serverNow: string | undefined,
  fetchedAt: number,
): ArrivalWindow {
  // The phone's clock as last read: at mount, and when the timer below fires. A newer fetch
  // (fetchedAt) is a newer reading too.
  const [readAt, setReadAt] = useState(() => Date.now());
  const offset = serverNow === undefined ? null : clockOffset(serverNow, fetchedAt);
  const state: ArrivalWindow =
    offset === null ? 'before' : arrivalWindowAt(tableAt, Math.max(readAt, fetchedAt) - offset);

  useEffect(() => {
    if (offset === null || state === 'after') return;
    const at = new Date(tableAt).getTime();
    const next =
      state === 'before' ? at - ARRIVAL_OPENS_BEFORE_MS : at + ARRIVAL_CLOSES_AFTER_MS + 1;
    const wait = Math.max(0, next + offset - Date.now()) + 1;
    // setTimeout cannot wait longer than ~24.8 days; a table is at most 30 days away, so cap it
    // and look again.
    const timer = setTimeout(() => setReadAt(Date.now()), Math.min(wait, 2_000_000_000));
    return () => clearTimeout(timer);
    // readAt is a dependency: if the timer ever fires a little early, the effect re-arms for the rest.
  }, [tableAt, offset, state, readAt]);

  return state;
}
